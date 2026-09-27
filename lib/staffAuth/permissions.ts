/**
 * Hak akses per role (diatur owner) untuk API server. Import HANYA dari API routes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { permissionLabel, permissionsForRole } from '@/lib/accessControl';
import { requireStaff, type OwnerStaff } from '@/lib/staffAuth/owner';

import type { paymentServiceDb } from '@/lib/paymentSecurity';

type Db = ReturnType<typeof paymentServiceDb>;
const noStore = { 'Cache-Control': 'no-store' };

/** Isi tabel role_permissions (role → daftar hak); null bila tabel belum ada → default. */
export async function loadStoredPermissions(db: Db): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from('role_permissions').select('role, permissions');
  if (error || !Array.isArray(data)) return null;
  return Object.fromEntries(data.map((r) => [String(r.role || '').toLowerCase(), r.permissions]));
}

export async function permissionsOfStaff(db: Db, role: string) {
  return permissionsForRole(role, await loadStoredPermissions(db));
}

/**
 * Staf login yang punya SALAH SATU hak di `anyOf`. Peran dibaca ulang dari
 * employees; hak dari role_permissions (owner selalu lolos).
 */
export async function requirePermission(
  req: NextRequest,
  db: Db,
  anyOf: string | readonly string[],
  forbidden?: string
): Promise<{ staff: OwnerStaff; perms: Set<string> } | { error: NextResponse }> {
  const me = await requireStaff(req, db);
  if ('error' in me) return me;
  const perms = await permissionsOfStaff(db, me.staff.role);
  const list = typeof anyOf === 'string' ? [anyOf] : anyOf;
  if (!list.some((p) => perms.has(p))) {
    const msg = forbidden || `Peran Anda belum diberi hak: ${list.map(permissionLabel).join(' / ')}. Minta owner mengaturnya di Hak Akses.`;
    return { error: NextResponse.json({ error: msg, code: 'PERMISSION_DENIED' }, { status: 403, headers: noStore }) };
  }
  return { staff: me.staff, perms };
}
