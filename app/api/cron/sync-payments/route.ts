import { NextResponse } from 'next/server';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, paymentServiceDb, verifySharedSecret } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';
import { resolveMayarApiKey } from '@/lib/mayarOutletKey';
import {
  fetchMayarSettledRows,
  fetchMayarTransactionDetail,
  pickMayarSettlementForInvoice
} from '@/lib/mayarSettlement';

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

  const oldest = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('transactions')
    .select(
      'id, receipt_number, amount, customer_phone, mayar_payment_id, payment_status, is_paid, status, created_at, outlet_id, pickup_id, payment_method'
    )
    .gte('created_at', oldest)
    .or('is_paid.is.null,is_paid.eq.false')
    .order('created_at', { ascending: false })
    .limit(80);

  if (error) {
    const fb = await supabase
      .from('transactions')
      .select(
        'id, receipt_number, amount, customer_phone, mayar_payment_id, payment_status, is_paid, status, created_at, outlet_id, pickup_id, payment_method'
      )
      .gte('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(80);
    if (fb.error) {
      await insertErrorLog({ source: 'cron_sync_payments', message: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return runSync(fb.data || []);
  }

  return runSync(rows || []);
}

async function runSync(rows: any[]) {
  const pending = rows.filter((r) => {
    if (!isPaymentLocked(r)) return false;
    const method = String(r.payment_method || '').toLowerCase();
    return method.includes('qris') || String(r.mayar_payment_id || '').trim();
  });
  const keyCache = new Map<string, string>();
  let synced = 0;
  const results: Array<{ id: string; status: string }> = [];
  const supabase = paymentServiceDb();
  const settledCache = new Map<string, Awaited<ReturnType<typeof fetchMayarSettledRows>>>();
  const paidIds = new Set(
    rows
      .filter((r) => !isPaymentLocked(r))
      .map((r) => String(r.mayar_payment_id || '').trim())
      .filter(Boolean)
  );

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
      keyCache.set(cacheKey, apiKey || '');
    }
    if (!apiKey) {
      results.push({ id: tx.id, status: 'skipped_no_key' });
      continue;
    }
    try {
      if (paymentId) {
        const gw = await fetchMayarTransactionDetail(apiKey, paymentId);
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
            continue;
          }
        }
      }

      let settled = settledCache.get(cacheKey);
      if (!settled) {
        settled = await fetchMayarSettledRows(apiKey, { limit: 50 });
        settledCache.set(cacheKey, settled);
      }
      const siblings = pending
        .filter((p) => Math.round(Number(p.amount || 0)) === Math.round(Number(tx.amount || 0)))
        .filter((p) => !tx.outlet_id || p.outlet_id === tx.outlet_id)
        .map((p) => ({ id: p.id, created_at: p.created_at }));
      const hit = pickMayarSettlementForInvoice(settled, {
        txId: tx.id,
        amount: Number(tx.amount || 0),
        txCreatedAt: tx.created_at,
        paymentId,
        receipt: tx.receipt_number,
        usedIds: paidIds,
        siblings
      });
      if (hit) {
        const claimId = hit.transactionId || hit.settlementId;
        await supabase.from('transactions').update({ mayar_payment_id: claimId }).eq('id', tx.id);
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
          results.push({ id: tx.id, status: 'paid_settlement' });
          paidIds.add(claimId);
          continue;
        }
      }
      results.push({ id: tx.id, status: 'still_pending' });
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
