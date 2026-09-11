import { NextResponse } from 'next/server';
import { findCashDeposit, settleCashDeposit } from '@/lib/cashDepositQris';
import { creditDepositTopup, findDepositTopup } from '@/lib/depositTopup';
import { markGatewayPaid } from '@/lib/paymentVerify';
import { paymentServiceDb } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

/**
 * Simulasi bayar untuk uji lokal/dev.
 * Tidak fetch ke /api/mayar/webhook sendiri — self-fetch di Next.js sering deadlock
 * (loading 40–50s lalu gagal).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.transactionId && !body.topupId && !body.cashDepositId && !body.receipt) {
      return NextResponse.json(
        { error: 'transactionId, topupId, cashDepositId, atau receipt wajib' },
        { status: 400 }
      );
    }

    const supabase = paymentServiceDb();
    const isCashDepositSim = !!(
      body.cashDepositId || String(body.receipt || '').toUpperCase().startsWith('SETOR-')
    );

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

    if (body.topupId || String(body.receipt || '').toUpperCase().startsWith('DEP-')) {
      const topup = await findDepositTopup(supabase, {
        topupId: body.topupId,
        paymentId: body.paymentId,
        receipt: body.receipt,
        mobile: body.customerPhone
      });
      if (topup) {
        const { error, already, balance } = await creditDepositTopup(supabase, topup, {
          agentName: 'Mayar Mock'
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({
          ok: true,
          status: 'success',
          type: 'deposit',
          topupId: topup.id,
          already: !!already,
          balance,
          simulate: true
        });
      }
    }

    let txId = String(body.transactionId || '').trim();
    if (!txId && body.receipt) {
      const { data } = await supabase
        .from('transactions')
        .select('id')
        .eq('receipt_number', String(body.receipt).trim())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      txId = String(data?.id || '').trim();
    }

    if (!txId) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan untuk simulasi' }, { status: 404 });
    }

    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('id, receipt_number, amount, customer_phone, is_paid, payment_status, status')
      .eq('id', txId)
      .maybeSingle();

    if (txErr || !tx) {
      return NextResponse.json(
        {
          error:
            txErr?.message ||
            'Transaksi tidak terbaca. Pastikan SUPABASE_SERVICE_ROLE_KEY ada di .env.local untuk simulasi lokal.'
        },
        { status: 404 }
      );
    }

    const { error } = await markGatewayPaid({
      transactionId: tx.id,
      receipt: tx.receipt_number || body.receipt,
      amount: Number(body.amount || tx.amount || 0),
      agentName: 'Mayar Mock',
      customerPhone: body.customerPhone || tx.customer_phone,
      paidVia: 'CHECK_STATUS'
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      status: 'success',
      transactionId: tx.id,
      is_paid: true,
      simulate: true
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Simulasi gagal' }, { status: 500 });
  }
}
