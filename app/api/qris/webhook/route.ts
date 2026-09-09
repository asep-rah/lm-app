import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { markGatewayPaid } from '@/lib/paymentVerify';
import {
  amountsMatch,
  insertErrorLog,
  insertWebhookLog,
  pickWebhookHeaders,
  verifySharedSecret
} from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawText = await req.text();
  let body: any = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = {};
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const token = req.headers.get('x-callback-token');
  const expected = process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN || process.env.PAYMENT_GATEWAY_SERVER_KEY || '';
  const sigOk = !expected || verifySharedSecret(token, expected);

  await insertWebhookLog({
    gateway: 'xendit',
    event_type: String(body?.event || body?.status || 'qris'),
    external_id: String(body?.external_id || ''),
    signature_ok: sigOk,
    amount_received: Number(body?.amount || 0) || null,
    status: 'RECEIVED',
    raw_payload: body,
    headers: pickWebhookHeaders(req)
  });

  try {
    if (expected && !sigOk) {
      await insertErrorLog({
        source: 'qris_webhook',
        code: 'WEBHOOK_SIGNATURE',
        message: 'Signature Webhook Tidak Cocok (Xendit)'
      });
      return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 403 });
    }

    const { status, amount, external_id, metadata } = body;

    if (status === 'PAID' || status === 'SETTLED' || body?.event === 'qr.payment') {
      const customerPhone = metadata?.customerPhone;
      const type = metadata?.type;
      const refId = external_id || body?.data?.qr_code?.reference_id || body?.data?.reference_id;

      if (type === 'deposit' && customerPhone) {
        const { data: customer } = await supabase
          .from('customers')
          .select('deposit_balance')
          .eq('phone', customerPhone)
          .single();

        const currentBalance = customer?.deposit_balance || 0;
        const newBalance = Number(currentBalance) + Number(amount || 0);

        await supabase
          .from('customers')
          .update({ deposit_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('phone', customerPhone);

        await supabase.from('membership_logs').insert([
          {
            customer_phone: customerPhone,
            amount: Number(amount || 0),
            type: 'topup_xendit',
            description: `Top-up Saldo via Xendit (${refId})`,
            created_at: new Date().toISOString()
          }
        ]);
      } else if (refId) {
        const { data: tx } = await supabase
          .from('transactions')
          .select('*')
          .eq('receipt_number', refId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tx) {
          const expectedAmt = Number(tx.amount || 0);
          const receivedAmt = Number(amount || 0);
          if (receivedAmt > 0 && expectedAmt > 0 && !amountsMatch(expectedAmt, receivedAmt)) {
            await insertErrorLog({
              source: 'qris_webhook',
              code: 'AMOUNT_MISMATCH',
              message: `Nominal Xendit ${receivedAmt} ≠ tagihan ${expectedAmt}`,
              transaction_id: tx.id
            });
            return NextResponse.json({ error: 'Amount mismatch' }, { status: 409 });
          }
          const { error } = await markGatewayPaid({
            transactionId: tx.id,
            receipt: tx.receipt_number,
            amount: expectedAmt,
            agentName: 'Xendit QRIS',
            customerPhone: tx.customer_phone,
            paidVia: 'GATEWAY'
          });
          if (error) {
            await insertErrorLog({
              source: 'qris_webhook',
              message: error.message,
              transaction_id: tx.id
            });
            return NextResponse.json({ error: error.message }, { status: 500 });
          }
        } else {
          await supabase
            .from('transactions')
            .update({
              status: 'Diterima',
              payment_status: 'Lunas',
              payment_method: 'Xendit Gateway',
              updated_at: new Date().toISOString()
            })
            .eq('receipt_number', refId);
        }
      }
    }

    return NextResponse.json({ status: 'success', message: 'OK' });
  } catch (error: any) {
    console.error('Xendit Webhook Error:', error);
    await insertErrorLog({ source: 'qris_webhook', message: error?.message || 'Webhook error' });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
