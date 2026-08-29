import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createMayarPayment, isMayarKeyValid } from '@/lib/mayar';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const amount = Math.round(Number(body.amount) || 0);
    if (amount < 1000) {
      return NextResponse.json({ error: 'Nominal pembayaran minimal Rp 1.000' }, { status: 400 });
    }

    let apiKey = String(body.apiKey || '').trim();
    let payoutAccountId = String(body.payoutAccountId || '').trim();
    if (body.outletId) {
      const { data: outlet } = await supabase
        .from('outlets')
        .select('mayar_api_key, mayar_payout_account_id')
        .eq('id', body.outletId)
        .maybeSingle();
      if (!outlet) {
        return NextResponse.json({ error: 'Outlet not found' }, { status: 404 });
      }
      if (isMayarKeyValid(outlet.mayar_api_key)) apiKey = String(outlet.mayar_api_key).trim();
      if (outlet.mayar_payout_account_id) payoutAccountId = String(outlet.mayar_payout_account_id).trim();
    }

    const charge = await createMayarPayment({
      amount,
      name: body.name,
      description: body.description,
      mobile: body.mobile,
      email: body.email,
      receipt: body.receipt,
      transactionId: body.transactionId,
      outletId: body.outletId,
      apiKey,
      payoutAccountId,
      baseUrl: new URL(req.url).origin
    });

    if (body.transactionId) {
      const attempts = [
        {
          mayar_payment_id: charge.paymentId,
          mayar_invoice_url: charge.invoiceUrl,
          payment_method: charge.mock ? 'QRIS (Mock)' : 'QRIS Mayar'
        },
        { mayar_payment_id: charge.paymentId, mayar_invoice_url: charge.invoiceUrl },
        { mayar_invoice_url: charge.invoiceUrl }
      ];
      for (const row of attempts) {
        const { error } = await supabase.from('transactions').update(row).eq('id', body.transactionId);
        if (!error) break;
      }
    }

    return NextResponse.json(charge);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Gagal membuat QRIS Mayar' }, { status: 500 });
  }
}
