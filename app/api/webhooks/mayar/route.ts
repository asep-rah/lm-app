import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { insertChatMessage } from '@/lib/csChat';
import { notifyCustomerPayment } from '@/lib/notifications';
import { completePaymentVerifyTasks, gatewayPaidAttempts } from '@/lib/paymentVerify';
import { isMayarPaidEvent, mayarWebhookRefs } from '@/lib/mayar';
import { creditDepositTopup, depositPackageOf, findDepositTopup } from '@/lib/depositTopup';
import { findCashDeposit, settleCashDeposit } from '@/lib/cashDepositQris';
import { maybeAwardLoyalty } from '@/lib/crm-automation';
import {
  amountsMatch,
  insertErrorLog,
  insertWebhookLog,
  pickWebhookHeaders,
  verifyPaymentSignature,
  verifySharedSecret
} from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

const findTransaction = async (refs: ReturnType<typeof mayarWebhookRefs>, explicitId?: string) => {
  if (explicitId) {
    const { data } = await supabase.from('transactions').select('*').eq('id', explicitId).maybeSingle();
    if (data) return data;
  }
  if (refs.paymentId) {
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('mayar_payment_id', refs.paymentId)
      .limit(1);
    if (data?.[0]) return data[0];
  }
  if (refs.receipt) {
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('receipt_number', refs.receipt)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
};

const applyPaid = async (tx: any, agentName: string, paidVia = 'GATEWAY') => {
  const attempts = gatewayPaidAttempts(agentName, paidVia);
  let lastErr: { message: string } | null = null;
  for (const row of attempts) {
    const { error } = await supabase.from('transactions').update(row).eq('id', tx.id);
    if (!error) {
      await completePaymentVerifyTasks(tx.id, tx.receipt_number);
      if (tx.customer_phone) {
        const nominal = Number(tx.amount || 0).toLocaleString('id-ID');
        await insertChatMessage({
          customer_phone: tx.customer_phone,
          pickup_order_id: tx.pickup_id || null,
          transaction_id: tx.id,
          sender_type: 'cs',
          sender_name: agentName,
          message: `Pembayaran QRIS sebesar Rp ${nominal} sudah terkonfirmasi (${agentName}). Cucian masuk antrean produksi.`
        });
        notifyCustomerPayment(tx.customer_phone);
      }
      maybeAwardLoyalty({ ...tx, is_paid: true, status: 'Diterima' });
      return { error: null };
    }
    lastErr = { message: error.message };
  }
  return { error: lastErr || { message: 'Gagal update transaksi' } };
};

export async function POST(req: Request) {
  const rawText = await req.text();
  let body: any = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = {};
  }

  const expected = process.env.MAYAR_WEBHOOK_TOKEN || process.env.MAYAR_WEBHOOK_SECRET || '';
  const header =
    req.headers.get('x-mayar-signature') ||
    req.headers.get('x-callback-token') ||
    req.headers.get('x-signature') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const isProd = process.env.NODE_ENV === 'production';
  const isCashDepositSim = !!(
    body?.simulate &&
    (body.cashDepositId ||
      body?.data?.cashDepositId ||
      String(body?.receipt || body?.data?.productName || '')
        .toUpperCase()
        .includes('SETOR-'))
  );

  const sigOk =
    verifySharedSecret(header, expected) ||
    verifyPaymentSignature({
      payload: rawText,
      signature: header,
      serverKey: process.env.PAYMENT_GATEWAY_SERVER_KEY || expected
    });

  await insertWebhookLog({
    gateway: 'mayar',
    event_type: String(body?.event || body?.type || 'unknown'),
    external_id: String(body?.data?.id || body?.id || ''),
    signature_ok: sigOk,
    amount_received: Number(body?.data?.amount || body?.amount || 0) || null,
    status: 'RECEIVED',
    raw_payload: body,
    headers: pickWebhookHeaders(req)
  });

  try {
    if (isProd && !isCashDepositSim) {
      if (!expected || !sigOk) {
        await insertErrorLog({
          source: 'mayar_webhook',
          code: 'WEBHOOK_SIGNATURE',
          message: 'Signature Webhook Tidak Cocok',
          context: { headerPresent: Boolean(header) }
        });
        return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 403 });
      }
    } else if (!isCashDepositSim && expected && !sigOk) {
      await insertErrorLog({
        source: 'mayar_webhook',
        code: 'WEBHOOK_SIGNATURE',
        message: 'Signature Webhook Tidak Cocok (dev)',
        severity: 'WARN'
      });
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 403 });
    }
    if (isProd && body?.simulate && !isCashDepositSim) {
      return NextResponse.json({ error: 'Simulasi dinonaktifkan' }, { status: 403 });
    }
    if (!isMayarPaidEvent(body) && !body?.simulate) {
      return NextResponse.json({ status: 'ignored', event: body?.event || null });
    }

    const refs = mayarWebhookRefs(body);
    const tx = await findTransaction(refs, body.transactionId || body?.data?.transactionId);
    if (tx) {
      const expectedAmt = Number(tx.amount || tx.total_amount || 0);
      const receivedAmt = Number(refs.amount || 0);
      if (receivedAmt > 0 && expectedAmt > 0 && !amountsMatch(expectedAmt, receivedAmt)) {
        await insertErrorLog({
          source: 'mayar_webhook',
          code: 'AMOUNT_MISMATCH',
          message: `Nominal webhook ${receivedAmt} ≠ tagihan ${expectedAmt}`,
          transaction_id: tx.id,
          context: { expectedAmt, receivedAmt, receipt: tx.receipt_number }
        });
        await insertWebhookLog({
          gateway: 'mayar',
          event_type: 'amount_mismatch',
          transaction_id: tx.id,
          amount_expected: expectedAmt,
          amount_received: receivedAmt,
          status: 'ERROR',
          error_message: 'Amount mismatch',
          raw_payload: body
        });
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 409 });
      }

      const { error } = await applyPaid(tx, body.simulate ? 'Mayar Mock' : 'Mayar QRIS', body.simulate ? 'CHECK_STATUS' : 'GATEWAY');
      if (error) {
        await insertErrorLog({
          source: 'mayar_webhook',
          code: 'DB_UPDATE',
          message: error.message,
          transaction_id: tx.id
        });
        await insertWebhookLog({
          gateway: 'mayar',
          transaction_id: tx.id,
          status: 'ERROR',
          error_message: error.message,
          raw_payload: body
        });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      await insertWebhookLog({
        gateway: 'mayar',
        transaction_id: tx.id,
        amount_expected: expectedAmt,
        amount_received: receivedAmt || expectedAmt,
        status: 'OK',
        raw_payload: { ok: true, transactionId: tx.id }
      });
      return NextResponse.json({ status: 'success', transactionId: tx.id, is_paid: true });
    }

    const cashDeposit = await findCashDeposit(supabase, {
      depositId: body.cashDepositId || body?.data?.cashDepositId,
      paymentId: refs.paymentId,
      receipt: refs.receipt
    });
    if (cashDeposit) {
      const { error, already } = await settleCashDeposit(supabase, cashDeposit);
      if (error) {
        await insertErrorLog({ source: 'mayar_webhook', message: error.message, code: 'CASH_DEPOSIT' });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        status: 'success',
        type: 'cash_deposit',
        cashDepositId: cashDeposit.id,
        balanced: true,
        already: !!already
      });
    }

    const topup = await findDepositTopup(supabase, {
      topupId: body.topupId || body?.data?.topupId,
      paymentId: refs.paymentId,
      receipt: refs.receipt,
      mobile: refs.mobile || body.customerPhone
    });
    if (topup) {
      const { error, already, balance } = await creditDepositTopup(supabase, topup, {
        agentName: body.simulate ? 'Mayar Mock' : 'Mayar QRIS'
      });
      if (error) {
        await insertErrorLog({ source: 'mayar_webhook', message: error.message, code: 'DEPOSIT_TOPUP' });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        status: 'success',
        type: 'deposit',
        topupId: topup.id,
        already: !!already,
        balance
      });
    }

    const desc = `${refs.data?.description || ''} ${refs.data?.productName || ''} ${body?.description || ''}`;
    const pkg = depositPackageOf(desc) || depositPackageOf(refs.receipt);
    if (pkg && (refs.mobile || body.customerPhone)) {
      const { error, balance } = await creditDepositTopup(
        supabase,
        {
          customer_phone: refs.mobile || body.customerPhone,
          customer_name: refs.data?.customerName || 'Pelanggan',
          package_name: pkg.key,
          amount: refs.amount || pkg.pay,
          balance_added: pkg.credit,
          mayar_payment_id: refs.paymentId,
          status: 'PENDING'
        },
        { agentName: body.simulate ? 'Mayar Mock' : 'Mayar QRIS' }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ status: 'success', type: 'deposit', balance });
    }

    await insertErrorLog({
      source: 'mayar_webhook',
      code: 'TX_NOT_FOUND',
      message: 'Transaksi / top-up tidak ditemukan',
      context: refs
    });
    return NextResponse.json({ error: 'Transaksi / top-up tidak ditemukan', refs }, { status: 404 });
  } catch (err: any) {
    console.error('Mayar webhook:', err);
    await insertErrorLog({
      source: 'mayar_webhook',
      message: err?.message || 'Webhook error',
      code: 'WEBHOOK_CRASH',
      context: { raw: body }
    });
    return NextResponse.json({ error: err?.message || 'Webhook error' }, { status: 500 });
  }
}
