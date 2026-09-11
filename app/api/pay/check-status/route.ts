import { NextResponse } from 'next/server';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, clientIp, paymentServiceDb } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';
import { resolveMayarApiKey } from '@/lib/mayarOutletKey';
import {
  fetchMayarSettledRows,
  fetchMayarTransactionDetail,
  pickMayarSettlementForInvoice,
  settlementRefIds
} from '@/lib/mayarSettlement';

export const dynamic = 'force-dynamic';

async function loadUsedMayarIds(
  supabase: ReturnType<typeof paymentServiceDb>,
  candidateIds: string[]
): Promise<Set<string>> {
  const used = new Set<string>();
  const ids = candidateIds.filter(Boolean).slice(0, 80);
  if (!ids.length) return used;
  const { data } = await supabase.from('transactions').select('mayar_payment_id').in('mayar_payment_id', ids);
  for (const row of data || []) {
    const id = String(row?.mayar_payment_id || '').trim();
    if (id) used.add(id);
  }
  return used;
}

async function loadPendingSiblings(
  supabase: ReturnType<typeof paymentServiceDb>,
  opts: { outletId?: string; amount: number; sinceIso: string }
) {
  const amount = Math.round(Number(opts.amount) || 0);
  let q = supabase
    .from('transactions')
    .select('id, created_at, amount, payment_status, is_paid, payment_method, status')
    .eq('amount', amount)
    .gte('created_at', opts.sinceIso)
    .order('created_at', { ascending: true })
    .limit(30);
  if (opts.outletId) q = q.eq('outlet_id', opts.outletId);
  const { data } = await q;
  return (data || []).filter((row: any) => {
    if (row?.is_paid === true) return false;
    const pay = String(row?.payment_status || '').toLowerCase();
    if (['paid', 'lunas', 'verified'].includes(pay)) return false;
    const method = String(row?.payment_method || '').toLowerCase();
    const st = String(row?.status || '').toLowerCase();
    return method.includes('qris') || st.includes('menunggu') || pay === 'pending';
  }) as Array<{ id: string; created_at: string }>;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = String(url.searchParams.get('order_id') || url.searchParams.get('transaction_id') || '').trim();
  if (!orderId) {
    return NextResponse.json({ error: 'order_id wajib' }, { status: 400 });
  }

  const supabase = paymentServiceDb();
  const { data: tx, error } = await supabase.from('transactions').select('*').eq('id', orderId).maybeSingle();
  if (error || !tx) {
    const byResi = await supabase
      .from('transactions')
      .select('*')
      .eq('receipt_number', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!byResi.data) {
      await insertErrorLog({ source: 'pay_check_status', code: 'TX_NOT_FOUND', message: `Order ${orderId} tidak ditemukan` });
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }
    return handleTx(byResi.data, req, supabase);
  }
  return handleTx(tx, req, supabase);
}

/** Kasir konfirmasi lunas — hanya fallback darurat, utamakan deteksi gateway. */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }
  const orderId = String(body.order_id || body.transactionId || '').trim();
  const confirm = Boolean(body.cashier_confirm || body.confirm);
  if (!orderId) return NextResponse.json({ error: 'order_id wajib' }, { status: 400 });
  if (!confirm) return NextResponse.json({ error: 'cashier_confirm wajib' }, { status: 400 });

  const supabase = paymentServiceDb();
  const { data: tx } = await supabase.from('transactions').select('*').eq('id', orderId).maybeSingle();
  if (!tx) return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });

  if (!isPaymentLocked(tx)) {
    return NextResponse.json({ status: 'PAID', is_paid: true, message: 'Sudah lunas' });
  }

  const { error } = await markGatewayPaid({
    transactionId: tx.id,
    receipt: tx.receipt_number,
    amount: Number(tx.amount || 0),
    agentName: String(body.agentName || 'Kasir POS'),
    customerPhone: tx.customer_phone,
    paidVia: 'CASHIER_CONFIRM',
    pickupId: tx.pickup_id
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void insertAuditLog({
    user_name: String(body.agentName || 'Kasir POS'),
    action: 'PAYMENT_CASHIER_CONFIRM',
    entity_type: 'transactions',
    entity_id: tx.id,
    amount: Number(tx.amount || 0),
    ip_address: clientIp(req)
  });

  return NextResponse.json({
    status: 'PAID',
    is_paid: true,
    message: 'Dikonfirmasi lunas oleh kasir'
  });
}

async function handleTx(tx: any, req: Request, supabase: ReturnType<typeof paymentServiceDb>) {
  if (!isPaymentLocked(tx)) {
    return NextResponse.json({
      status: 'PAID',
      payment_status: tx.payment_status,
      is_paid: true,
      message: 'Sudah lunas'
    });
  }

  const paymentId = String(tx.mayar_payment_id || '').trim();
  const apiKey = await resolveMayarApiKey(supabase, tx.outlet_id);
  const amount = Number(tx.amount || 0);
  const receipt = String(tx.receipt_number || '').trim();

  const markPaid = async (via: string, message: string, settledId?: string) => {
    if (settledId && settledId !== paymentId) {
      await supabase.from('transactions').update({ mayar_payment_id: settledId }).eq('id', tx.id);
    }
    const { error } = await markGatewayPaid({
      transactionId: tx.id,
      receipt: tx.receipt_number,
      amount,
      agentName: via,
      customerPhone: tx.customer_phone,
      paidVia: 'CHECK_STATUS',
      pickupId: tx.pickup_id
    });
    if (error) {
      await insertErrorLog({
        source: 'pay_check_status',
        message: error.message,
        transaction_id: tx.id
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    void insertAuditLog({
      action: 'PAYMENT_CHECK_STATUS_PAID',
      entity_type: 'transactions',
      entity_id: tx.id,
      amount,
      ip_address: clientIp(req),
      meta: { via, settledId: settledId || null }
    });
    return NextResponse.json({
      status: 'PAID',
      payment_status: 'paid',
      is_paid: true,
      message
    });
  };

  if (paymentId && apiKey && !paymentId.startsWith('mock_')) {
    try {
      const gw = await fetchMayarTransactionDetail(apiKey, paymentId);
      if (gw && isMayarPaidEvent(gw)) {
        return markPaid('Cek Status (Mayar detail)', 'Pembayaran terkonfirmasi dari Payment Gateway', paymentId);
      }
    } catch (err: any) {
      await insertErrorLog({
        source: 'pay_check_status',
        code: 'API_TIMEOUT',
        message: err?.message || 'Gagal query gateway',
        transaction_id: tx.id
      });
    }
  }

  // Klaim settlement Mayar (QRIS dinamis / Xendit) yang belum terpakai.
  if (apiKey && amount >= 1000) {
    try {
      const txTs = tx.created_at ? new Date(tx.created_at).getTime() : Date.now() - 60 * 60 * 1000;
      const rows = await fetchMayarSettledRows(apiKey, {
        limit: 50,
        dateFromMs: Math.max(0, txTs - 2 * 60 * 1000)
      });
      const candidateIds = rows.flatMap((r) => settlementRefIds(r));
      const usedIds = await loadUsedMayarIds(supabase, candidateIds);
      if (paymentId) usedIds.delete(paymentId); // id sendiri boleh
      const sinceIso = new Date(Math.max(0, txTs - 2 * 60 * 60 * 1000)).toISOString();
      const siblings = await loadPendingSiblings(supabase, {
        outletId: tx.outlet_id,
        amount,
        sinceIso
      });
      const hit = pickMayarSettlementForInvoice(rows, {
        txId: tx.id,
        amount,
        txCreatedAt: tx.created_at,
        paymentId: paymentId.startsWith('mock_') ? '' : paymentId,
        receipt,
        usedIds,
        siblings
      });
      if (hit?.transactionId || hit?.settlementId) {
        const claimId = hit.transactionId || hit.settlementId;
        // Double-check belum diklaim transaksi lain
        const { data: taken } = await supabase
          .from('transactions')
          .select('id')
          .eq('mayar_payment_id', claimId)
          .neq('id', tx.id)
          .limit(1);
        if (!taken?.length) {
          return markPaid(
            `Cek Status (Mayar ${hit.via})`,
            'Pembayaran QRIS terdeteksi otomatis di Mayar',
            claimId
          );
        }
      }
    } catch (err: any) {
      await insertErrorLog({
        source: 'pay_check_status',
        code: 'MAYAR_SETTLEMENT',
        message: err?.message || 'Gagal cocokkan settlement Mayar',
        transaction_id: tx.id
      });
    }
  }

  const { data: fresh } = await supabase.from('transactions').select('*').eq('id', tx.id).maybeSingle();
  return NextResponse.json({
    status: isPaymentLocked(fresh || tx) ? 'PENDING' : 'PAID',
    payment_status: (fresh || tx).payment_status,
    is_paid: !isPaymentLocked(fresh || tx),
    message: isPaymentLocked(fresh || tx)
      ? 'Belum terdeteksi lunas di gateway. Tunggu 5–15 detik lalu Cek Status lagi (settlement Mayar kadang agak lambat).'
      : 'Sudah lunas'
  });
}
