import { NextResponse } from 'next/server';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import { markGatewayPaid } from '@/lib/paymentVerify';
import { insertErrorLog } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

/**
 * Legacy Xendit path — dialihkan ke jalur lunas yang sama (is_paid + audit).
 * Prefer `/api/qris/webhook` untuk Xendit penuh; endpoint ini mencegah orphan "Diterima saja".
 */
export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const referenceId =
      payload.data?.qr_code?.reference_id || payload.data?.reference_id || payload.reference_id;

    if (payload.event === 'qr.payment' && payload.data?.status === 'COMPLETED' && referenceId) {
      const supabase = paymentServiceDb();
      const { data: tx } = await supabase
        .from('transactions')
        .select('id, receipt_number, amount, customer_phone, pickup_id, is_paid, payment_status, status')
        .eq('receipt_number', referenceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tx?.id) {
        const { error } = await markGatewayPaid({
          transactionId: tx.id,
          receipt: tx.receipt_number,
          amount: Number(tx.amount || 0),
          agentName: 'Xendit Legacy Webhook',
          customerPhone: tx.customer_phone,
          paidVia: 'GATEWAY',
          pickupId: tx.pickup_id
        });
        if (error) {
          await insertErrorLog({
            source: 'qris_webhook_legacy',
            message: error.message,
            transaction_id: tx.id
          });
          return NextResponse.json({ message: error.message }, { status: 500 });
        }
        return NextResponse.json({ status: 'OK', is_paid: true, transactionId: tx.id });
      }
    }

    return NextResponse.json({ status: 'OK' });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
