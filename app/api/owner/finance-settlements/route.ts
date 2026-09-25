import { NextResponse, type NextRequest } from 'next/server';
import { validateSettlement } from '@/lib/financeSettlement';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const TABLE = 'finance_settlements';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof paymentServiceDb>;

/**
 * Pembayaran bagi hasil / THR crew yang dicatat owner (lib/financeSettlement).
 * Hanya owner: role dibaca ulang dari employees (sesi bertanda tangan tidak
 * dipercaya untuk role). Setiap catat/batal masuk audit_logs. Tidak ada hapus.
 */
async function currentOwner(req: NextRequest, db: Db) {
  const session = readStaffSession(req);
  if (!session) {
    const e = staffSessionError(staffSessionProblem(req) === 'not_configured' ? 'not_configured' : 'missing');
    return { error: NextResponse.json(e.body, { status: e.status, headers: noStore }) };
  }
  const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
  if (!staff) return { error: deny(401, 'Akun tidak ditemukan. Masuk lagi.') };
  if (String(staff.role || '').toLowerCase() !== 'owner') return { error: deny(403, 'Hanya owner yang boleh mencatat pembayaran bagi hasil / THR.') };
  return { staff: { id: String(staff.id), name: String(staff.name || ''), role: String(staff.role || '') } };
}

const failed = async (e: unknown, code: string) => {
  await insertErrorLog({ source: 'finance_settlements', code, message: String((e as Error)?.message || e).slice(0, 300) });
  return deny(500, 'Belum bisa diproses. Coba lagi sebentar lagi.');
};

export async function GET(req: NextRequest) {
  try {
    const db = paymentServiceDb();
    const me = await currentOwner(req, db);
    if ('error' in me) return me.error;
    const { data, error } = await db.from(TABLE).select('*').order('paid_at', { ascending: true }).limit(5000);
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
    return NextResponse.json({ settlements: data || [] }, { headers: noStore });
  } catch (e) {
    return failed(e, 'SETTLEMENT_LIST_FAILED');
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const db = paymentServiceDb();
    const me = await currentOwner(req, db);
    if ('error' in me) return me.error;
    const audit = (action: string, id: string, meta: Record<string, unknown>, amount?: number) =>
      insertAuditLog({
        user_id: me.staff.id,
        user_name: me.staff.name,
        role: me.staff.role,
        action,
        entity_type: TABLE,
        entity_id: id,
        amount: amount ?? null,
        meta,
        ip_address: clientIp(req)
      });

    if (body.action === 'void') {
      const id = String(body.id || '');
      if (!UUID.test(id)) return deny(400, 'Data tidak valid.');
      const reason = String(body.reason || '').trim().slice(0, 200);
      if (reason.length < 3) return deny(400, 'Tulis alasan pembatalan.');
      const { data: row } = await db.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!row) return deny(404, 'Catatan pembayaran tidak ditemukan.');
      if (row.voided_at) return NextResponse.json({ settlement: row, already: true }, { headers: noStore });
      const patch = { voided_at: new Date().toISOString(), voided_by: me.staff.name || me.staff.id, void_reason: reason };
      const { error } = await db.from(TABLE).update(patch).eq('id', id);
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
      await audit('finance_settlement_voided', id, { kind: row.kind, outlet_id: row.outlet_id, reason }, Number(row.amount));
      return NextResponse.json({ settlement: { ...row, ...patch } }, { headers: noStore });
    }

    const check = validateSettlement(body);
    if (!check.ok) return deny(400, check.error);
    const { data: outlet } = await db.from('outlets').select('id').eq('id', check.draft.outlet_id).maybeSingle();
    if (!outlet) return deny(400, 'Outlet tidak ditemukan.');
    const row = { ...check.draft, created_by: me.staff.id, created_by_name: me.staff.name };
    const { data, error } = await db.from(TABLE).insert([row]).select('*');
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
    const saved = data?.[0] || row;
    await audit(
      'finance_settlement_created',
      String(saved.id || ''),
      { kind: row.kind, outlet_id: row.outlet_id, paid_at: row.paid_at, source: row.source, note: row.note },
      row.amount
    );
    return NextResponse.json({ settlement: saved }, { headers: noStore });
  } catch (e) {
    return failed(e, 'SETTLEMENT_WRITE_FAILED');
  }
}
