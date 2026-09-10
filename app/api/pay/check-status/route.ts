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

  if (paymentId && apiKey && !paymentId.startsWith('mock_')) {
    try {
      const gw = await fetchMayarStatus(paymentId, apiKey);
      if (gw && isMayarPaidEvent(gw)) {
        const { error } = await markGatewayPaid({
          transactionId: tx.id,
          receipt: tx.receipt_number,
          amount: Number(tx.amount || 0),
          agentName: 'Cek Status (Mayar)',
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
          amount: Number(tx.amount || 0),
          ip_address: clientIp(req)
        });
        return NextResponse.json({
          status: 'PAID',
          payment_status: 'paid',
          is_paid: true,
          message: 'Pembayaran terkonfirmasi dari Payment Gateway'
        });
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

  const { data: fresh } = await supabase.from('transactions').select('*').eq('id', tx.id).maybeSingle();
  return NextResponse.json({
    status: isPaymentLocked(fresh || tx) ? 'PENDING' : 'PAID',
    payment_status: (fresh || tx).payment_status,
    is_paid: !isPaymentLocked(fresh || tx),
    message: isPaymentLocked(fresh || tx)
      ? 'Belum terdeteksi lunas di gateway. Tunggu webhook atau hubungi CS.'
      : 'Sudah lunas'
  });
}
