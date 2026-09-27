import { NextResponse, type NextRequest } from 'next/server';
import { CONFIGURABLE_ROLES, cleanPermissions, permissionsForRole } from '@/lib/accessControl';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { requireOwner } from '@/lib/staffAuth/owner';
import { loadStoredPermissions } from '@/lib/staffAuth/permissions';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const ROLES = new Set<string>(CONFIGURABLE_ROLES.map((r) => r.value));

/**
 * Owner mengatur hak akses satu role: { role, permissions: [...] } atau
 * { role, reset: true } (kembali ke default). Hanya owner; owner sendiri tidak
 * bisa diatur (selalu penuh). Sebelum & sesudah tercatat di audit_logs.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const role = String(body.role || '').toLowerCase().trim();
  if (!ROLES.has(role)) return deny(400, 'Role tidak dikenal.');
  const reset = body.reset === true;
  if (!reset && !Array.isArray(body.permissions)) return deny(400, 'Daftar hak tidak valid.');
  const next = reset ? null : cleanPermissions(body.permissions);

  try {
    const db = paymentServiceDb();
    const me = await requireOwner(req, db, 'Hanya owner yang boleh mengatur hak akses.');
    if ('error' in me) return me.error;
    const stored = await loadStoredPermissions(db);
    if (stored === null) return deny(503, 'Tabel hak akses belum dibuat. Jalankan migrasi 20261010_role_permissions.sql.');
    const before = [...permissionsForRole(role, stored)];

    if (reset) {
      const { error } = await db.from('role_permissions').delete().eq('role', role);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from('role_permissions')
        .upsert([{ role, permissions: next, updated_by: me.staff.name || me.staff.id, updated_at: new Date().toISOString() }], { onConflict: 'role' });
      if (error) throw new Error(error.message);
    }
    const after = reset ? [...permissionsForRole(role, null)] : next || [];
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: reset ? 'role_permissions_reset' : 'role_permissions_updated',
      entity_type: 'role_permissions',
      entity_id: role,
      meta: { before, after },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true, role, permissions: after }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'role_permissions', code: 'ROLE_PERMISSIONS_SAVE_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Hak akses belum tersimpan. Coba lagi sebentar lagi.');
  }
}
