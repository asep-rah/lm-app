import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findCashDeposit, settleCashDeposit } from '@/lib/cashDepositQris';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

/** Test Auto-Payment: settle cash deposit directly, then optionally fan-out webhook. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.transactionId && !body.topupId && !body.cashDepositId && !body.receipt) {
      return NextResponse.json({ error: 'transactionId, topupId, cashDepositId, atau receipt wajib' }, { status: 400 });
    }

    const isCashDepositSim = !!(body.cashDepositId || String(body.receipt || '').toUpperCase().startsWith('SETOR-'));
    if (isCashDepositSim) {
      const deposit = await findCashDeposit(supabase, {
        depositId: body.cashDepositId,
        paymentId: body.paymentId,
        receipt: body.receipt
      });
      if (!deposit) {
        return NextResponse.json({ error: 'Setoran tidak ditemukan untuk simulasi' }, { status: 404 });
      }
      const { error, already } = await settleCashDeposit(supabase, deposit);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        status: 'success',
        type: 'cash_deposit',
        cashDepositId: deposit.id,
        balanced: true,
        already: !!already,
        simulate: true
      });
    }

    const origin = new URL(req.url).origin;
    const payload = {
      event: 'payment.received',
      simulate: true,
      transactionId: body.transactionId || null,
      topupId: body.topupId || null,
      cashDepositId: body.cashDepositId || null,
      customerPhone: body.customerPhone || '',
      data: {
        status: 'SUCCESS',
        transactionStatus: 'paid',
        id: body.paymentId || `sim_${Date.now()}`,
        transactionId: body.transactionId || null,
        topupId: body.topupId || null,
        cashDepositId: body.cashDepositId || null,
        amount: Number(body.amount) || 0,
        customerMobile: body.customerPhone || '',
        productName: `Laundrivery ${body.receipt || ''}`.trim(),
        description: `Simulasi auto-pay ${body.receipt || body.cashDepositId || body.topupId || body.transactionId}`
      }
    };

    const res = await fetch(`${origin}/api/mayar/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MAYAR_WEBHOOK_TOKEN || process.env.MAYAR_WEBHOOK_SECRET
          ? { 'x-callback-token': process.env.MAYAR_WEBHOOK_TOKEN || process.env.MAYAR_WEBHOOK_SECRET || '' }
          : {})
      },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: json?.error || 'Simulasi gagal' }, { status: res.status });
    }
    return NextResponse.json({ ok: true, ...json });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Simulasi gagal' }, { status: 500 });
  }
}
