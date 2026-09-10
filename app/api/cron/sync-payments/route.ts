import { NextResponse } from 'next/server';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, paymentServiceDb, verifySharedSecret } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';
import { resolveMayarApiKey } from '@/lib/mayarOutletKey';

export const dynamic = 'force-dynamic';

const authCron = (req: Request) => {
  const expected = process.env.CRON_SECRET || process.env.CLEANUP_CRON_SECRET || '';
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-cron-secret') ||
    '';
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) return Boolean(expected) && verifySharedSecret(header, expected);
  if (expected) return verifySharedSecret(header, expected);
  return true;
};

async function fetchMayarStatus(paymentId: string, apiKey: string) {
  try {
    const res = await fetch(`https://api.mayar.id/hl/v1/payment/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = paymentServiceDb();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Service role missing' }, { status: 503 });
  }

  // Jendela: 5 menit – 7 hari (catch-up orphan webhook)
  const now = Date.now();
  const oldest = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const newest = new Date(now - 5 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, receipt_number, amount, customer_phone, mayar_payment_id, payment_status, is_paid, status, created_at, outlet_id, pickup_id'
    )
    .gte('created_at', oldest)
    .lte('created_at', newest)
    .not('mayar_payment_id', 'is', null)
    .or('is_paid.is.null,is_paid.eq.false')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    // Fallback bila filter or() tidak didukung
    const fb = await supabase
      .from('transactions')
      .select(
        'id, receipt_number, amount, customer_phone, mayar_payment_id, payment_status, is_paid, status, created_at, outlet_id, pickup_id'
      )
      .gte('created_at', oldest)
      .lte('created_at', newest)
      .not('mayar_payment_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(60);
    if (fb.error) {
      await insertErrorLog({ source: 'cron_sync_payments', message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return runSync(fb.data || []);
  }

  return runSync(rows || []);
}

async function runSync(rows: any[]) {
  const pending = rows.filter((r) => isPaymentLocked(r) && String(r.mayar_payment_id || '').trim());
  const keyCache = new Map<string, string>();
  let synced = 0;
  const results: Array<{ id: string; status: string }> = [];
  const supabase = paymentServiceDb();

  for (const tx of pending) {
    const paymentId = String(tx.mayar_payment_id || '');
    if (paymentId.startsWith('mock_')) {
      results.push({ id: tx.id, status: 'skipped' });
      continue;
    }
    const cacheKey = String(tx.outlet_id || '_global');
    let apiKey = keyCache.get(cacheKey);
    if (apiKey === undefined) {
      apiKey = await resolveMayarApiKey(supabase, tx.outlet_id);
      keyCache.set(cacheKey, apiKey);
    }
    if (!apiKey) {
      results.push({ id: tx.id, status: 'skipped_no_key' });
      continue;
    }
    try {
      const gw = await fetchMayarStatus(paymentId, apiKey);
      if (gw && isMayarPaidEvent(gw)) {
        const { error: payErr } = await markGatewayPaid({
          transactionId: tx.id,
          receipt: tx.receipt_number,
          amount: Number(tx.amount || 0),
          agentName: 'Cron Sync',
          customerPhone: tx.customer_phone,
          paidVia: 'CRON_SYNC',
          pickupId: tx.pickup_id
        });
        if (!payErr) {
          synced += 1;
          results.push({ id: tx.id, status: 'paid' });
        } else {
          results.push({ id: tx.id, status: 'error' });
          await insertErrorLog({
            source: 'cron_sync_payments',
            message: payErr.message,
            transaction_id: tx.id
          });
        }
      } else {
        results.push({ id: tx.id, status: 'still_pending' });
      }
    } catch (err: any) {
      await insertErrorLog({
        source: 'cron_sync_payments',
        code: 'API_TIMEOUT',
        message: err?.message || 'Gateway timeout',
        transaction_id: tx.id
      });
      results.push({ id: tx.id, status: 'timeout' });
    }
  }

  void insertAuditLog({
    action: 'CRON_SYNC_PAYMENTS',
    role: 'system',
    meta: { scanned: pending.length, synced }
  });

  return NextResponse.json({
    ok: true,
    scanned: pending.length,
    synced,
    results
  });
}

export async function POST(req: Request) {
  return GET(req);
}
