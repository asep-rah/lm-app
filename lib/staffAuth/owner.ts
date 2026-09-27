/**
 * Owner-only API guard: signed staff session + role re-read from employees
 * (the session's own role is not trusted). Import ONLY from API routes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';

import type { paymentServiceDb } from '@/lib/paymentSecurity';

type Db = ReturnType<typeof paymentServiceDb>;
const noStore = { 'Cache-Control': 'no-store' };

export type OwnerStaff = { id: string; name: string; role: string };

/**
 * Staf yang login (sesi bertanda tangan); peran dibaca ulang dari employees.
 * roles: daftar peran yang boleh (huruf kecil); kosong = semua staf.
 */
export async function requireStaff(
  req: NextRequest,
  db: Db,
  roles: readonly string[] | null = null,
  forbidden = 'Peran Anda tidak boleh melakukan ini.'
): Promise<{ staff: OwnerStaff } | { error: NextResponse }> {
  const session = readStaffSession(req);
  if (!session) {
    const e = staffSessionError(staffSessionProblem(req) === 'not_configured' ? 'not_configured' : 'missing');
    return { error: NextResponse.json(e.body, { status: e.status, headers: noStore }) };
  }
  const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
  if (!staff) return { error: NextResponse.json({ error: 'Akun tidak ditemukan. Masuk lagi.' }, { status: 401, headers: noStore }) };
  const role = String(staff.role || '').toLowerCase();
  if (roles && !roles.includes(role)) {
    return { error: NextResponse.json({ error: forbidden }, { status: 403, headers: noStore }) };
  }
  return { staff: { id: String(staff.id), name: String(staff.name || ''), role } };
}

export async function requireOwner(req: NextRequest, db: Db, forbidden = 'Hanya owner yang boleh melakukan ini.'): Promise<{ staff: OwnerStaff } | { error: NextResponse }> {
  return requireStaff(req, db, ['owner'], forbidden);
}
