import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Test Auto-Payment: POST the same webhook receiver with a mock paid event. */
export async function POST(req: Request) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Simulasi dinonaktifkan di production' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    if (!body.transactionId && !body.topupId && !body.cashDepositId && !body.receipt) {
      return NextResponse.json({ error: 'transactionId, topupId, cashDepositId, atau receipt wajib' }, { status: 400 });
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

    const res = await fetch(`${origin}/api/webhooks/mayar`, {
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
