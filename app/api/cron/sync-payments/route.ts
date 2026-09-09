import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';

export const dynamic = 'force-dynamic';

const authCron = (req: Request) => {
  const expected = process.env.CRON_SECRET || process.env.CLEANUP_CRON_SECRET || '';
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-cron-secret') ||
    '';
  const isProd = process.env.NODE_ENV === 'production';
  // Vercel Cron mengirim Authorization: Bearer $CRON_SECRET otomatis jika env ada.
  if (isProd) return Boolean(expected) && header === expected;
  if (expected) return header === expected;
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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  );

  const now = Date.now();
  const minAge = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const maxAge = new Date(now - 10 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('transactions')
    .select('id, receipt_number, amount, customer_phone, mayar_payment_id, payment_status, is_paid, status, created_at')
    .gte('created_at', minAge)
    .lte('created_at', maxAge)
    .limit(80);

  if (error) {
    await insertErrorLog({ source: 'cron_sync_payments', message: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pending = (rows || []).filter((r) => isPaymentLocked(r) && String(r.mayar_payment_id || '').trim());
  const apiKey = String(process.env.MAYAR_API_KEY || '').trim();
  let synced = 0;
  const results: Array<{ id: string; status: string }> = [];

  for (const tx of pending) {
    const paymentId = String(tx.mayar_payment_id || '');
    if (!apiKey || paymentId.startsWith('mock_')) {
      results.push({ id: tx.id, status: 'skipped' });
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
          paidVia: 'CRON_SYNC'
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
