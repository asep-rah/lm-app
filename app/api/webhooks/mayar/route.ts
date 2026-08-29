import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { insertChatMessage } from '@/lib/csChat';
import { completePaymentVerifyTasks, gatewayPaidAttempts } from '@/lib/paymentVerify';
import { isMayarPaidEvent, mayarWebhookRefs } from '@/lib/mayar';

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

const applyPaid = async (tx: any, agentName: string) => {
  const attempts = gatewayPaidAttempts(agentName);
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
      }
      return { error: null };
    }
    lastErr = { message: error.message };
  }
  return { error: lastErr || { message: 'Gagal update transaksi' } };
};

export async function POST(req: Request) {
  try {
    const secret = process.env.MAYAR_WEBHOOK_SECRET;
    if (secret) {
      const header =
        req.headers.get('x-mayar-signature') ||
        req.headers.get('x-callback-token') ||
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (header !== secret) {
        return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    if (!isMayarPaidEvent(body) && !body?.simulate) {
      return NextResponse.json({ status: 'ignored', event: body?.event || null });
    }

    const refs = mayarWebhookRefs(body);
    const tx = await findTransaction(refs, body.transactionId || body?.data?.transactionId);
    if (!tx) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan', refs }, { status: 404 });
    }

    const { error } = await applyPaid(tx, body.simulate ? 'Mayar Mock' : 'Mayar QRIS');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ status: 'success', transactionId: tx.id, is_paid: true });
  } catch (err: any) {
    console.error('Mayar webhook:', err);
    return NextResponse.json({ error: err?.message || 'Webhook error' }, { status: 500 });
  }
}
