import { NextResponse, type NextRequest } from 'next/server';
import { insertPendingCashDepositDb } from '@/lib/cashDepositQris';
import { cashierIdForColumn, isUuidString } from '@/lib/outletUuid';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const METHODS = new Set(['INDOMARET_ALFAMART', 'MBANKING_PERSONAL']);

/**
 * Setoran kas kasir (tombol "Kirim Setoran" di POS) — dulu ditulis langsung dari
 * browser. Sekarang oleh server: sesi staf wajib, kasir = staf yang login (bukan
 * isi body), status selalu PENDING (hanya webhook Mayar yang menandai BALANCED).
 * Biaya admin Indomaret/Alfamart dicatat sebagai pengeluaran seperti sebelumnya.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu sering. Coba lagi sebentar lagi.');
  const session = readStaffSession(req);
  if (!session) {
    const e = staffSessionError(staffSessionProblem(req) === 'not_configured' ? 'not_configured' : 'missing');
    return NextResponse.json(e.body, { status: e.status, headers: noStore });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const outletId = String(body.outletId || '');
  const method = String(body.method || '');
  const amount = Math.round(Number(body.amountCash) || 0);
  const fee = method === 'INDOMARET_ALFAMART' ? Math.max(0, Math.round(Number(body.adminFee) || 0)) : 0;
  const note = String(body.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  if (!isUuidString(outletId)) return deny(400, 'Outlet tidak valid. Pilih cabang ulang.');
  if (!METHODS.has(method)) return deny(400, 'Metode setoran tidak dikenal.');
  if (amount <= 0 || amount > 1_000_000_000) return deny(400, 'Masukkan nominal setoran cash yang valid!');
  if (fee >= amount) return deny(400, 'Biaya admin tidak boleh ≥ nominal setoran.');

  try {
    const db = paymentServiceDb();
    const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
    if (!staff) return deny(401, 'Akun tidak ditemukan. Masuk lagi.');
    const { data: outlet } = await db.from('outlets').select('id').eq('id', outletId).maybeSingle();
    if (!outlet) return deny(400, 'Outlet tidak ditemukan.');

    const cashier = cashierIdForColumn(staff.id);
    const { data, error } = await insertPendingCashDepositDb(db, {
      outlet_id: outletId,
      cashier_id: cashier || String(staff.id),
      kasir_id: String(staff.id),
      amount_cash: amount,
      admin_fee: fee,
      net_deposit_amount: Math.max(0, amount - fee),
      deposit_method: method,
      proof_url: note || 'Setor via QRIS Meja Kasir'
    });
    if (error) throw new Error(error.message);
    const deposit = data?.[0];

    if (fee > 0) {
      const notes = `Biaya Admin Top-Up Setoran Cash (${method})`;
      const { error: feeErr } = await db.from('expenses').insert([{ outlet_id: outletId, amount: fee, notes, category: 'Biaya Admin' }]);
      if (feeErr) {
        const retry = await db.from('expenses').insert([{ outlet_id: outletId, amount: fee, notes }]);
        if (retry.error) await insertErrorLog({ source: 'cash_deposit', code: 'ADMIN_FEE_EXPENSE_FAILED', message: retry.error.message.slice(0, 300) });
      }
    }

    await insertAuditLog({
      user_id: String(staff.id),
      user_name: String(staff.name || ''),
      role: String(staff.role || ''),
      action: 'cash_deposit_submitted',
      entity_type: 'cash_deposits',
      entity_id: String(deposit?.id || ''),
      amount,
      meta: { outlet_id: outletId, method, admin_fee: fee },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ deposit }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'cash_deposit', code: 'CASH_DEPOSIT_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Setoran belum tersimpan. Coba lagi sebentar lagi.');
  }
}
