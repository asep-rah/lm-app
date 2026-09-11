import { NextResponse } from 'next/server';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, clientIp, paymentServiceDb } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';
import { resolveMayarApiKey } from '@/lib/mayarOutletKey';

export const dynamic = 'force-dynamic';

async function fetchMayarStatus(paymentId: string, apiKey: string) {
  const urls = [
    `https://api.mayar.id/hl/v1/payment/${encodeURIComponent(paymentId)}`,
    `https://api.mayar.id/hl/v2/payments/${encodeURIComponent(paymentId)}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      /* try next */
    }
  }
  return null;
}

/** QRIS dinamis Mayar sering beda ID dari payment-link — cocokkan dari daftar transaksi lunas terbaru. */
async function findRecentMayarPaidMatch(
  apiKey: string,
  amount: number,
  txCreatedAt?: string
): Promise<{ id?: string; matched: boolean } | null> {
  const target = Math.round(Number(amount) || 0);
  if (!apiKey || target < 1000) return null;
  const txTs = txCreatedAt ? new Date(txCreatedAt).getTime() : Date.now();
  const windowMs = 60 * 60 * 1000; // 1 jam
  const urls = [
    'https://api.mayar.id/hl/v2/transactions?limit=30&status=settled',
    'https://api.mayar.id/hl/v1/transactions?page=1&pageSize=30'
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      });
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      for (const row of rows) {
        const st = String(row?.status || '').toLowerCase();
        if (st && !['settled', 'paid', 'success', 'lunas', 'completed'].includes(st)) continue;
        const credit = Math.round(Number(row?.credit ?? 0) || 0);
        const rowAmt = Math.round(Number(row?.amount ?? row?.grossAmount ?? row?.totalAmount ?? 0) || 0);
        const close = (a: number, b: number) => a === b || Math.abs(a - b) <= 100;
        const okAmt = (credit > 0 && close(credit, target)) || (rowAmt > 0 && close(rowAmt, target));
        if (!okAmt) continue;
        const created = Number(row?.createdAt || row?.created_at || 0);
        const createdMs =
          created > 1e12
            ? created
            : created > 1e9
              ? created * 1000
              : Date.parse(String(row?.createdAt || row?.created_at || '')) || 0;
        if (createdMs && Math.abs(createdMs - txTs) > windowMs) continue;
        const method = String(row?.paymentMethod || row?.payment_method || row?.balanceHistoryType || '').toLowerCase();
        if (method && !/(qris|qr|payme|ewallet|e-wallet)/i.test(method)) {
          // izinkan jika nominal cocok ketat (tanpa fee)
          if (!close(credit || rowAmt, target) || Math.abs((credit || rowAmt) - target) > 1) continue;
        }
        return { id: String(row?.id || ''), matched: true };
      }
    } catch {
      /* try next */
    }
  }
  return null;
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

/** Kasir konfirmasi lunas setelah lihat bukti e-wallet (QRIS dinamis). */
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

  const markPaid = async (via: string, message: string) => {
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
      meta: { via }
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
      const gw = await fetchMayarStatus(paymentId, apiKey);
      if (gw && isMayarPaidEvent(gw)) {
        return markPaid('Cek Status (Mayar Link)', 'Pembayaran terkonfirmasi dari Payment Gateway');
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

  // Fallback: bayar via QRIS dinamis (bukan payment-link) → cari di daftar transaksi Mayar yang settled.
  if (apiKey && amount >= 1000) {
    try {
      const hit = await findRecentMayarPaidMatch(apiKey, amount, tx.created_at);
      if (hit?.matched) {
        return markPaid('Cek Status (Mayar QRIS dinamis)', 'Pembayaran QRIS terdeteksi di Mayar (cocok nominal)');
      }
    } catch (err: any) {
      await insertErrorLog({
        source: 'pay_check_status',
        code: 'MAYAR_TX_LIST',
        message: err?.message || 'Gagal list transaksi Mayar',
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
      ? 'Belum terdeteksi lunas di gateway. Tunggu sebentar lalu Cek Status lagi, atau konfirmasi manual di kasir jika bukti bayar sudah ada.'
      : 'Sudah lunas'
  });
}
