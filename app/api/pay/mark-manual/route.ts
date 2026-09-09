import { NextResponse } from 'next/server';
import { markInvoicePaid } from '@/lib/paymentVerify';
import { clientIp, insertAuditLog, insertErrorLog } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const transactionId = String(body.transactionId || body.order_id || '').trim();
    const note = String(body.note || '').trim();
    const proofUrl = String(body.proofUrl || body.proof_url || '').trim();
    const bankRef = String(body.bankRef || body.bank_ref || '').trim();
    const agentName = String(body.agentName || body.agent_name || 'CS').trim();
    const role = String(body.role || 'cs').trim();

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId wajib' }, { status: 400 });
    }
    if (!note || note.length < 5) {
      return NextResponse.json({ error: 'Catatan verifikasi wajib (min. 5 karakter)' }, { status: 400 });
    }
    if (!proofUrl && !bankRef) {
      return NextResponse.json({ error: 'Lampirkan bukti pembayaran (URL) atau nomor referensi bank' }, { status: 400 });
    }

    const { error } = await markInvoicePaid({
      transactionId,
      amount: Number(body.amount || 0) || undefined,
      proofUrl: proofUrl || undefined,
      receipt: body.receipt,
      agentName,
      customerPhone: body.customerPhone,
      paidVia: 'MANUAL_VERIFIED',
      note,
      bankRef: bankRef || undefined
    });

    if (error) {
      await insertErrorLog({
        source: 'pay_mark_manual',
        message: error.message,
        transaction_id: transactionId
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    void insertAuditLog({
      user_name: agentName,
      role,
      action: 'PAYMENT_MANUAL_VERIFIED',
      entity_type: 'transactions',
      entity_id: transactionId,
      amount: Number(body.amount || 0) || null,
      meta: { note, bankRef, proofUrl },
      ip_address: clientIp(req)
    });

    return NextResponse.json({ status: 'success', is_paid: true, paid_via: 'MANUAL_VERIFIED' });
  } catch (err: any) {
    await insertErrorLog({ source: 'pay_mark_manual', message: err?.message || 'Manual mark failed' });
    return NextResponse.json({ error: err?.message || 'Gagal' }, { status: 500 });
  }
}
