import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { requireOwner } from '@/lib/staffAuth/owner';
import { softVoidTransaction } from '@/lib/voidTx';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * Owner menyetujui void (soft-void) satu transaksi. Browser tidak lagi boleh
 * mengubah is_void / voided_at (trigger transactions_guard_payment); void hanya
 * lewat sini: owner (dibaca ulang dari employees), alasan wajib, tercatat di audit_logs.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const txId = String(body.transactionId || '').trim();
  const reason = String(body.reason || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  if (!txId || txId.length > 64) return deny(400, 'Transaksi tidak valid.');
  if (reason.length < 3) return deny(400, 'Tulis alasan void.');
  try {
    const db = paymentServiceDb();
    const me = await requireOwner(req, db, 'Hanya owner yang boleh menyetujui void transaksi.');
    if ('error' in me) return me.error;
    const { data: tx } = await db.from('transactions').select('id, receipt_number, amount, outlet_id, is_void').eq('id', txId).maybeSingle();
    if (!tx) return deny(404, 'Transaksi tidak ditemukan.');
    if (tx.is_void === true) return NextResponse.json({ ok: true, already: true }, { headers: noStore });

    const { error } = await softVoidTransaction(txId, { reason, approvedBy: me.staff.name || 'owner' }, db);
    if (error) throw new Error(error.message);
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: 'transaction_voided',
      entity_type: 'transactions',
      entity_id: txId,
      amount: Number(tx.amount) || null,
      meta: { receipt: tx.receipt_number, outlet_id: tx.outlet_id, reason },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'void_transaction', code: 'VOID_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Void belum tersimpan. Coba lagi sebentar lagi.');
  }
}
