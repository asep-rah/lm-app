import { NextResponse } from 'next/server';
import { creditCustomerDeposit, decrementCustomerDeposit } from '@/lib/depositTopup';
import { insertAuditLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { requirePaymentOpsAuth } from '@/lib/requirePaymentOpsAuth';

export const dynamic = 'force-dynamic';

/**
 * Mutasi saldo deposit hanya lewat server (service role).
 * Anon tidak boleh lagi eksekusi RPC credit/debit langsung.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const auth = await requirePaymentOpsAuth(
    req,
    {
      staffId: String(body.staffId || ''),
      agentName: String(body.agentName || ''),
      role: String(body.role || '')
    },
    'manual'
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const action = String(body.action || '').toLowerCase();
  const phone = String(body.phone || '').trim();
  const amount = Number(body.amount);
  const paymentId = String(body.paymentId || '').trim();

  if (!phone || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'phone / amount tidak valid' }, { status: 400 });
  }
  if (action !== 'credit' && action !== 'debit') {
    return NextResponse.json({ error: 'action harus credit|debit' }, { status: 400 });
  }

  try {
    const db = paymentServiceDb();
    if (action === 'debit') {
      const out = await decrementCustomerDeposit(db, phone, amount);
      if (out.error) {
        return NextResponse.json({ error: out.error.message }, { status: 400 });
      }
      await insertAuditLog({
        action: 'DEPOSIT_DEBIT',
        user_id: auth.staffId,
        user_name: auth.agentName,
        role: auth.role,
        entity_type: 'customer_deposit',
        entity_id: phone,
        amount,
        meta: { balance: out.balance }
      });
      return NextResponse.json({ ok: true, balance: out.balance });
    }

    const pid = paymentId || `pos-credit-${phone}-${Date.now()}`;
    const out = await creditCustomerDeposit(db, phone, amount, pid);
    if (out.error) {
      return NextResponse.json({ error: out.error.message }, { status: 400 });
    }
    await insertAuditLog({
      action: 'DEPOSIT_CREDIT',
      user_id: auth.staffId,
      user_name: auth.agentName,
      role: auth.role,
      entity_type: 'customer_deposit',
      entity_id: phone,
      amount,
      meta: { paymentId: pid, balance: out.balance, already: out.already }
    });
    return NextResponse.json({ ok: true, balance: out.balance, already: out.already, paymentId: pid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Gagal mutasi deposit' }, { status: 500 });
  }
}
