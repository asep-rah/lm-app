import { NextResponse } from 'next/server';
import { markInvoicePaid } from '@/lib/paymentVerify';
import { clientIp, insertAuditLog, insertErrorLog } from '@/lib/paymentSecurity';
import { requirePaymentOpsAuth } from '@/lib/requirePaymentOpsAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await requirePaymentOpsAuth(req, body, 'manual');
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const transactionId = String(body.transactionId || body.order_id || '').trim();
    const note = String(body.note || '').trim();
    const proofUrl = String(body.proofUrl || body.proof_url || '').trim();
    const bankRef = String(body.bankRef || body.bank_ref || '').trim();

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId wajib' }, { status: 400 });
    }
    if (!note || note.length < 5) {
      return NextResponse.json({ error: 'Catatan verifikasi wajib (min. 5 karakter)' }, { status: 400 });
    }
    if (!proofUrl && !bankRef) {
      return NextResponse.json({ error: 'Lampirkan bukti pembayaran (URL) atau nomor referensi bank' }, { status: 400 });
    }

    const result = await markInvoicePaid({
      transactionId,
      amount: Number(body.amount || 0) || undefined,
      proofUrl: proofUrl || undefined,
      receipt: body.receipt,
      agentName: auth.agentName,
      customerPhone: body.customerPhone,
      paidVia: 'MANUAL_VERIFIED',
      note,
      bankRef: bankRef || undefined
    });

    if (result.error) {
      await insertErrorLog({
        source: 'pay_mark_manual',
        message: result.error.message,
        transaction_id: transactionId
      });
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    void insertAuditLog({
      user_name: auth.agentName,
      role: auth.role,
      action: result.alreadyPaid ? 'PAYMENT_MANUAL_IDEMPOTENT' : 'PAYMENT_MANUAL_VERIFIED',
      entity_type: 'transactions',
      entity_id: transactionId,
      amount: Number(body.amount || 0) || null,
      meta: { note, bankRef, proofUrl, staffId: auth.staffId, alreadyPaid: result.alreadyPaid },
      ip_address: clientIp(req)
    });

    return NextResponse.json({
      status: 'success',
      is_paid: true,
      paid_via: 'MANUAL_VERIFIED',
      already_paid: Boolean(result.alreadyPaid)
    });
  } catch (err: any) {
    await insertErrorLog({ source: 'pay_mark_manual', message: err?.message || 'Manual mark failed' });
    return NextResponse.json({ error: err?.message || 'Gagal' }, { status: 500 });
  }
}
