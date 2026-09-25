import { NextResponse, type NextRequest } from 'next/server';
import { canSetOutletCapacity } from '@/lib/outletCapacity';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mark an outlet "penuh" (hidden from the customer order form) or open it
 * again. Only the owner and supervisors; the role is re-read from employees
 * (the signed session is not trusted for the role). Audited.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const session = readStaffSession(req);
  if (!session) {
    const e = staffSessionError(staffSessionProblem(req) === 'not_configured' ? 'not_configured' : 'missing');
    return NextResponse.json(e.body, { status: e.status, headers: noStore });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const outletId = String(body.outletId || '');
  if (!UUID.test(outletId)) return deny(400, 'Outlet tidak valid.');
  if (typeof body.full !== 'boolean') return deny(400, 'Status penuh tidak valid.');
  const full = body.full;

  try {
    const db = paymentServiceDb();
    const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
    if (!staff) return deny(401, 'Akun tidak ditemukan. Masuk lagi.');
    if (!canSetOutletCapacity(staff.role)) return deny(403, 'Hanya owner dan supervisor yang boleh mengubah status penuh outlet.');

    const { data: outlet, error: readErr } = await db.from('outlets').select('id, name, is_overcapacity').eq('id', outletId).maybeSingle();
    if (readErr) throw new Error(`${readErr.code ?? ''} ${readErr.message}`.trim());
    if (!outlet) return deny(404, 'Outlet tidak ditemukan.');

    if (Boolean(outlet.is_overcapacity) !== full) {
      const { error } = await db.from('outlets').update({ is_overcapacity: full }).eq('id', outletId);
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
      await insertAuditLog({
        user_id: String(staff.id),
        user_name: String(staff.name || ''),
        role: String(staff.role || ''),
        action: full ? 'outlet_marked_full' : 'outlet_reopened',
        entity_type: 'outlets',
        entity_id: outletId,
        meta: { outlet: outlet.name },
        ip_address: clientIp(req)
      });
    }
    return NextResponse.json({ id: outletId, name: outlet.name, is_overcapacity: full }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'outlet_capacity', code: 'OUTLET_CAPACITY_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Status outlet belum tersimpan. Coba lagi sebentar lagi.');
  }
}
