import { NextResponse, type NextRequest } from 'next/server';
import { drawerBalanceNow } from '@/lib/financeServer';
import { cashierIdForColumn, isUuidString } from '@/lib/outletUuid';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * Closing shift kasir (blind cash count). "Kas sistem" = saldo Kas Tunai Belum
 * Disetor outlet di buku besar saat ini (penjualan tunai + top up tunai −
 * pengeluaran dari laci − setoran − pembayaran dari laci ± closing sebelumnya).
 * Selisihnya dijurnal (kurang → 600027 Kerugian, lebih → 400008), jadi laci di
 * neraca kembali sama dengan uang fisik. Sesi staf wajib; ditulis oleh server.
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
  const physical = Math.round(Number(body.physicalCash));
  const notes = String(body.notes || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) || 'Closing Shift Kasir Regular';
  if (!isUuidString(outletId)) return deny(400, 'Outlet tidak valid. Pilih cabang ulang.');
  if (!Number.isFinite(physical) || physical < 0 || physical > 1_000_000_000) return deny(400, 'Isi jumlah uang fisik di laci.');

  try {
    const db = paymentServiceDb();
    const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
    if (!staff) return deny(401, 'Akun tidak ditemukan. Masuk lagi.');
    const { data: outlet } = await db.from('outlets').select('id').eq('id', outletId).maybeSingle();
    if (!outlet) return deny(400, 'Outlet tidak ditemukan.');

    const expected = Math.round(await drawerBalanceNow(db, outletId));
    const difference = physical - expected;
    const row = {
      outlet_id: outletId,
      cashier_id: cashierIdForColumn(staff.id) || String(staff.id),
      system_expected_cash: expected,
      physical_actual_cash: physical,
      cash_difference: difference,
      notes: `${notes} · ${staff.name || 'Kasir'}`,
      expected_source: 'ledger'
    };
    const { data, error } = await db.from('cash_closings').insert([row]).select('*');
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());

    await insertAuditLog({
      user_id: String(staff.id),
      user_name: String(staff.name || ''),
      role: String(staff.role || ''),
      action: 'cash_closing',
      entity_type: 'cash_closings',
      entity_id: String(data?.[0]?.id || ''),
      amount: difference,
      meta: { outlet_id: outletId, expected, physical },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ expected, physical, difference }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'cash_closing', code: 'CASH_CLOSING_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Closing belum tersimpan. Coba lagi sebentar lagi.');
  }
}
