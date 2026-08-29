import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createMayarPayment, isMayarKeyValid } from '@/lib/mayar';
import { DEPOSIT_PACKAGES, depositIncomeTitle, depositReceiptOf, insertPendingDepositTopup, normalizeCustomerPhone } from '@/lib/depositTopup';

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

    const isDeposit = String(body.type || '') === 'deposit';
    let apiKey = String(body.apiKey || '').trim();
    let payoutAccountId = String(body.payoutAccountId || '').trim();
    if (body.outletId) {
      const { data: outlet } = await supabase
        .from('outlets')
        .select('mayar_api_key, mayar_payout_account_id')
        .eq('id', body.outletId)
        .maybeSingle();
      if (!outlet && !isDeposit) {
        return NextResponse.json({ error: 'Outlet not found' }, { status: 404 });
      }
      if (outlet && isMayarKeyValid(outlet.mayar_api_key)) apiKey = String(outlet.mayar_api_key).trim();
      if (outlet?.mayar_payout_account_id) payoutAccountId = String(outlet.mayar_payout_account_id).trim();
    }
    const depositPkg = isDeposit
      ? DEPOSIT_PACKAGES.find((p) => p.key === body.packageName || String(body.packageName || '').includes(p.key)) ||
        DEPOSIT_PACKAGES.find((p) => p.pay === amount)
      : null;
    const depositReceipt = isDeposit ? String(body.receipt || depositReceiptOf(depositPkg?.key || 'Deposit')) : '';

    const charge = await createMayarPayment({
      amount,
      name: body.name || (isDeposit ? depositIncomeTitle({ package_name: depositPkg?.key || 'Deposit' }) : undefined),
      description:
        body.description ||
        (isDeposit ? `${depositIncomeTitle({ package_name: depositPkg?.key || 'Deposit' })} ${depositReceipt}` : undefined),
      mobile: body.mobile || body.customerPhone,
      email: body.email,
      receipt: depositReceipt || body.receipt,
      transactionId: isDeposit ? undefined : body.transactionId,
      outletId: body.outletId,
      apiKey,
      payoutAccountId,
      baseUrl: new URL(req.url).origin
    });

    if (body.transactionId && String(body.type || '') !== 'deposit') {
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

    if (isDeposit) {
      const pkg = depositPkg;
      const phone = normalizeCustomerPhone(body.mobile || body.customerPhone || '');
      const receipt = depositReceipt;
      const { data: pending } = await insertPendingDepositTopup(supabase, {
        customer_phone: phone,
        customer_name: body.customerName || body.name || 'Pelanggan',
        outlet_id: body.outletId || '',
        package_name: depositIncomeTitle({ package_name: pkg?.key || body.packageName || 'Deposit' }),
        amount,
        balance_added: Number(body.balanceAdded || pkg?.credit || amount),
        mayar_payment_id: charge.paymentId,
        mayar_invoice_url: charge.invoiceUrl,
        receipt,
        payment_method: charge.mock ? 'QRIS Mayar (Mock)' : 'QRIS Mayar'
      });
      const topupId = pending?.[0]?.id || null;
      let invoiceUrl = charge.invoiceUrl;
      if (charge.mock && topupId) {
        const origin = new URL(req.url).origin;
        invoiceUrl = `${origin}/pay/mock/${encodeURIComponent(charge.paymentId)}?resi=${encodeURIComponent(
          receipt
        )}&amount=${amount}&topup=${encodeURIComponent(topupId)}&phone=${encodeURIComponent(phone)}`;
      }
      return NextResponse.json({
        ...charge,
        invoiceUrl,
        topupId,
        receipt,
        packageName: pkg?.key || body.packageName,
        balanceAdded: Number(body.balanceAdded || pkg?.credit || amount)
      });
    }

    return NextResponse.json(charge);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Gagal membuat QRIS Mayar' }, { status: 500 });
  }
}
