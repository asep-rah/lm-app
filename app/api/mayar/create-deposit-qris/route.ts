import { NextResponse, type NextRequest } from 'next/server';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';
import { serverSupabase } from '@/lib/supabaseServer';
import { createMayarPayment, isMayarKeyValid } from '@/lib/mayar';
import { cashDepositReceiptOf, insertPendingCashDepositDb, netDepositOf } from '@/lib/cashDepositQris';
import { CASHIER_SESSION_MISSING, cashierIdForColumn, resolveOutletUuid } from '@/lib/outletUuid';

export const dynamic = 'force-dynamic';

const supabase = serverSupabase();

export async function POST(req: NextRequest) {
  // Sesi staf wajib: kasir = staf yang login (bukan kasir_id dari body).
  const session = readStaffSession(req);
  if (!session) {
    const e = staffSessionError(staffSessionProblem(req) === 'not_configured' ? 'not_configured' : 'missing');
    return NextResponse.json(e.body, { status: e.status });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const outletRaw = String(body.outlet_id || body.outletId || '').trim();
    const kasirRaw = String(session.sid);
    const physical = Math.round(Number(body.physical_cash ?? body.amount_cash ?? body.net_deposit_amount) || 0);
    const adminFee = Math.max(0, Math.round(Number(body.admin_fee ?? body.adminFee) || 0));
    const net = Math.round(Number(body.net_deposit_amount ?? netDepositOf(physical, adminFee)) || 0);
    const shiftDate = String(body.shift_date || body.shiftDate || new Date().toISOString().slice(0, 10)).slice(0, 10);

    const outletId = await resolveOutletUuid(supabase, outletRaw);
    if (!outletId) {
      return NextResponse.json(
        { error: 'outlet_id wajib UUID outlet. ID numerik lama (contoh "18") harus dipetakan ke outlets.id.' },
        { status: 400 }
      );
    }
    if (net < 1000) {
      return NextResponse.json({ error: 'Nominal setoran QRIS minimal Rp 1.000 (fisik minus biaya admin)' }, { status: 400 });
    }

    const { data: outlet } = await supabase
      .from('outlets')
      .select('id, name, mayar_api_key, mayar_payout_account_id')
      .eq('id', outletId)
      .maybeSingle();
    if (!outlet) {
      return NextResponse.json({ error: 'Outlet tidak ditemukan' }, { status: 404 });
    }
    const cashierId = cashierIdForColumn(kasirRaw || body.id || body.user_id);
    if (!kasirRaw && !cashierId) {
      return NextResponse.json({ error: CASHIER_SESSION_MISSING }, { status: 400 });
    }
    if (!cashierId) {
      return NextResponse.json({ error: CASHIER_SESSION_MISSING }, { status: 400 });
    }

    const receipt = cashDepositReceiptOf(outletId, shiftDate);
    const apiKey = isMayarKeyValid(outlet.mayar_api_key) ? String(outlet.mayar_api_key).trim() : '';
    const payoutAccountId = String(outlet.mayar_payout_account_id || '').trim();

    const charge = await createMayarPayment({
      amount: net,
      name: `Setoran Kasir ${outlet.name || ''}`.trim(),
      description: `Setoran tunai harian ${receipt} · ${outlet.name || outletId}`,
      receipt,
      outletId,
      apiKey,
      payoutAccountId,
      baseUrl: new URL(req.url).origin
    });

    const { data, error } = await insertPendingCashDepositDb(supabase, {
      outlet_id: outletId,
      cashier_id: cashierId,
      kasir_id: kasirRaw || cashierId,
      amount_cash: physical || net + adminFee,
      admin_fee: adminFee,
      net_deposit_amount: net,
      deposit_method: 'MAYAR_QRIS',
      mayar_payment_id: charge.paymentId,
      mayar_invoice_url: charge.invoiceUrl,
      qris_image_url: charge.qrisUrl,
      receipt,
      shift_date: shiftDate,
      proof_url: charge.invoiceUrl || 'Setor via QRIS Mayar'
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deposit = data?.[0];
    let paymentUrl = charge.invoiceUrl;
    if (charge.mock && deposit?.id) {
      const origin = new URL(req.url).origin;
      paymentUrl = `${origin}/pay/mock/${encodeURIComponent(charge.paymentId)}?resi=${encodeURIComponent(
        receipt
      )}&amount=${net}&cashDeposit=${encodeURIComponent(deposit.id)}`;
    }

    return NextResponse.json({
      qris_image_url: charge.qrisUrl,
      payment_url: paymentUrl,
      mayar_transaction_id: charge.paymentId,
      deposit_id: deposit?.id || null,
      receipt,
      net_deposit_amount: net,
      admin_fee: adminFee,
      mock: charge.mock
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Gagal membuat QRIS setoran' }, { status: 500 });
  }
}
