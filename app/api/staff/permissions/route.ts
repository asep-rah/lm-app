import { NextResponse, type NextRequest } from 'next/server';
import { CONFIGURABLE_ROLES, permissionsForRole } from '@/lib/accessControl';
import { insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { requireStaff } from '@/lib/staffAuth/owner';
import { loadStoredPermissions } from '@/lib/staffAuth/permissions';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Hak akses staf yang login (menu & tombol di browser mengikuti ini; aksi tetap
 * dicek ulang di server). Owner juga menerima seluruh matriks untuk diatur.
 */
export async function GET(req: NextRequest) {
  try {
    const db = paymentServiceDb();
    const me = await requireStaff(req, db);
    if ('error' in me) return me.error;
    const stored = await loadStoredPermissions(db);
    const permissions = [...permissionsForRole(me.staff.role, stored)];
    if (me.staff.role !== 'owner') return NextResponse.json({ role: me.staff.role, permissions }, { headers: noStore });
    const matrix = Object.fromEntries(CONFIGURABLE_ROLES.map((r) => [r.value, [...permissionsForRole(r.value, stored)]]));
    const customized = CONFIGURABLE_ROLES.map((r) => r.value).filter((r) => stored && Object.prototype.hasOwnProperty.call(stored, r));
    return NextResponse.json({ role: me.staff.role, permissions, matrix, customized, tableReady: stored !== null }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'staff_permissions', code: 'PERMISSIONS_LOAD_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return NextResponse.json({ error: 'Hak akses belum bisa dimuat.' }, { status: 500, headers: noStore });
  }
}
