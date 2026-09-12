import { NextResponse } from 'next/server';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, clientIp, paymentServiceDb } from '@/lib/paymentSecurity';
import { isMayarPaidEvent, closeMayarPaymentRequest } from '@/lib/mayar';
import { resolveMayarApiKey } from '@/lib/mayarOutletKey';
import {
  fetchMayarSettledRows,
  fetchMayarTransactionDetail,
  fetchMayarWebhookPaidEvents,
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
  // Hanya ID yang sudah dipakai transaksi LUNAS — pending jangan memblokir klaim.
  const { data } = await supabase
    .from('transactions')
    .select('mayar_payment_id, is_paid, payment_status')
    .in('mayar_payment_id', ids);
  for (const row of data || []) {
    const id = String(row?.mayar_payment_id || '').trim();
    if (!id) continue;
    if (row?.is_paid === true) used.add(id);
    const pay = String(row?.payment_status || '').toLowerCase();
    if (['paid', 'lunas', 'verified'].includes(pay)) used.add(id);
  }
  return used;
}

async function loadPendingSiblings(
  supabase: ReturnType<typeof paymentServiceDb>,
  opts: { outletId?: string; amount: number; sinceIso: string; current?: { id: string; created_at: string } }
) {
  const amount = Math.round(Number(opts.amount) || 0);
  let q = supabase
    .from('transactions')
    .select('id, created_at, amount, payment_status, is_paid, payment_method, status')
    .eq('amount', amount)
    .gte('created_at', opts.sinceIso)
    .order('created_at', { ascending: true })
    .limit(40);
  if (opts.outletId) q = q.eq('outlet_id', opts.outletId);
  const { data } = await q;
  const list = (data || []).filter((row: any) => {
    if (row?.is_paid === true) return false;
    const pay = String(row?.payment_status || '').toLowerCase();
    if (['paid', 'lunas', 'verified'].includes(pay)) return false;
    const method = String(row?.payment_method || '').toLowerCase();
    const st = String(row?.status || '').toLowerCase();
    return method.includes('qris') || st.includes('menunggu') || pay === 'pending' || !method;
  }) as Array<{ id: string; created_at: string }>;

  if (opts.current && !list.some((r) => r.id === opts.current!.id)) {
    list.push(opts.current);
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return list;
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

/** Kasir konfirmasi lunas — fallback darurat. */
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

  if (!apiKey) {
    return NextResponse.json({
      status: 'PENDING',
      is_paid: false,
      message: 'Mayar API Key outlet belum diisi — tidak bisa cek status otomatis.'
    });
  }

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
    if (apiKey) {
      const linkId = String(tx.mayar_link_payment_id || '').trim();
      const closeId = linkId || (String(tx.mayar_invoice_url || '').includes('mayar') ? paymentId : '');
      if (closeId && !/^(qris_|mock_|pos_)/i.test(closeId)) {
        void closeMayarPaymentRequest(apiKey, closeId);
      }
      void supabase.from('transactions').update({ mayar_invoice_url: null }).eq('id', tx.id);
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

  // Detail Mayar hanya berguna untuk ID payment-request / transaction (bukan UUID gambar QR).
  if (paymentId && !/^(mock_|qris_|pos_)/i.test(paymentId)) {
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

  if (amount >= 1000) {
    try {
      const txTs = tx.created_at ? new Date(tx.created_at).getTime() : Date.now() - 60 * 60 * 1000;
      const rows = await fetchMayarSettledRows(apiKey, {
        limit: 50,
        dateFromMs: Math.max(0, txTs - 5 * 60 * 1000)
      });
      const candidateIds = rows.flatMap((r) => settlementRefIds(r));
      const usedIds = await loadUsedMayarIds(supabase, candidateIds);
      const sinceIso = new Date(Math.max(0, txTs - 3 * 60 * 60 * 1000)).toISOString();
      const siblings = await loadPendingSiblings(supabase, {
        outletId: tx.outlet_id,
        amount,
        sinceIso,
        current: { id: tx.id, created_at: tx.created_at }
      });
      const hit = pickMayarSettlementForInvoice(rows, {
        txId: tx.id,
        amount,
        txCreatedAt: tx.created_at,
        paymentId: /^(mock_|qris_|pos_)/i.test(paymentId) ? '' : paymentId,
        receipt,
        usedIds,
        siblings
      });
      if (hit?.transactionId || hit?.settlementId) {
        const claimId = hit.transactionId || hit.settlementId;
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

      // Fallback: webhook history payment.received (sering lebih cepat dari list settlement)
      const wh = await fetchMayarWebhookPaidEvents(apiKey, {
        amount,
        txCreatedAt: tx.created_at,
        limit: 30
      });
      for (const ev of wh) {
        if (usedIds.has(ev.id)) continue;
        if (ev.receipt && receipt && ev.receipt.toUpperCase() !== receipt.toUpperCase()) continue;
        const { data: taken } = await supabase
          .from('transactions')
          .select('id')
          .eq('mayar_payment_id', ev.id)
          .neq('id', tx.id)
          .limit(1);
        if (taken?.length) continue;
        // Jika ada resi di webhook, harus cocok; kalau tidak, hanya klaim bila 1 pending
        if (!ev.receipt && siblings.length > 1) {
          const openBefore = siblings.filter((s) => new Date(s.created_at).getTime() <= ev.createdMs + 30_000);
          const owner = openBefore[openBefore.length - 1];
          if (!owner || owner.id !== tx.id) continue;
        }
        return markPaid('Cek Status (Mayar webhook history)', 'Pembayaran QRIS terdeteksi dari riwayat Mayar', ev.id);
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
      ? 'Belum terdeteksi lunas di gateway. Tunggu 5–20 detik lalu Cek Status lagi.'
      : 'Sudah lunas'
  });
}
