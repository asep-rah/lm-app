import { NextResponse, type NextRequest } from 'next/server';
import { EXPENSE_PAID_FROM } from '@/lib/financeSettlement';
import { lockedPeriodFor } from '@/lib/financeServer';
import { isUuidString } from '@/lib/outletUuid';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { insertWithFallbackOn, updateWithFallbackOn } from '@/lib/safeWrite';
import { requireStaff } from '@/lib/staffAuth/owner';
import { requirePermission } from '@/lib/staffAuth/permissions';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 60, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max);
const PAID_FROM = new Set<string>(EXPENSE_PAID_FROM.map((p) => p.value));
const MAX_AMOUNT = 1_000_000_000;
const lockedMsg = (lock: string) => `Periode sudah ditutup buku (s.d. ${lock}). Hubungi owner.`;

/**
 * Pengeluaran (expenses) ditulis server. Browser tidak lagi bisa menambah /
 * mengubah pengeluaran (beban palsu atau mengubah nominal lama).
 *  - op 'create': staf login (POS, Admin Ops, pembayaran pengajuan pembelian).
 *    created_by = staf yang login. Pengajuan yang sama tidak tercatat dua kali.
 *  - op 'update': revisi nominal/keterangan (hak 'expense.revise'); nilai lama
 *    & baru tercatat di audit_logs.
 * Tutup buku diperiksa di sini (trigger DB hanya mengunci browser).
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu sering. Coba lagi sebentar lagi.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const op = String(body.op || 'create');
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return deny(400, 'Nominal pengeluaran tidak valid.');
  const description = text(body.description, 500);

  try {
    const db = paymentServiceDb();
    if (op === 'update') {
      const id = text(body.id, 64);
      if (!id) return deny(400, 'Pengeluaran tidak valid.');
      const me = await requirePermission(req, db, 'expense.revise');
      if ('error' in me) return me.error;
      const { data: old } = await db.from('expenses').select('id, outlet_id, amount, description, created_at').eq('id', id).maybeSingle();
      if (!old) return deny(404, 'Pengeluaran tidak ditemukan.');
      const lock = await lockedPeriodFor(db, old.outlet_id as string, (old.created_at as string) || new Date());
      if (lock) return deny(409, lockedMsg(lock));
      const { error } = await updateWithFallbackOn(db, 'expenses', [{ amount, description }], { column: 'id', value: id });
      if (error) throw new Error(error.message);
      await insertAuditLog({
        user_id: me.staff.id,
        user_name: me.staff.name,
        role: me.staff.role,
        action: 'expense_revised',
        entity_type: 'expenses',
        entity_id: id,
        amount,
        meta: { outlet_id: old.outlet_id, before: { amount: Number(old.amount) || 0, description: old.description ?? null }, after: { amount, description } },
        ip_address: clientIp(req)
      });
      return NextResponse.json({ ok: true }, { headers: noStore });
    }

    if (op !== 'create') return deny(400, 'Operasi tidak dikenal.');
    const outletId = text(body.outletId, 64);
    if (!isUuidString(outletId)) return deny(400, 'Outlet tidak valid. Pilih cabang ulang.');
    const category = text(body.category, 120) || 'Lain-lain';
    const paidFrom = text(body.paidFrom, 20);
    if (paidFrom && !PAID_FROM.has(paidFrom)) return deny(400, 'Sumber dana tidak valid.');
    const requisitionId = text(body.requisitionId, 64);
    const proofRaw = String(body.proofUrl || '').trim();
    const proofUrl = /^https?:\/\//i.test(proofRaw) && proofRaw.length <= 2000 ? proofRaw : '';

    const me = await requireStaff(req, db);
    if ('error' in me) return me.error;
    const { data: outlet } = await db.from('outlets').select('id').eq('id', outletId).maybeSingle();
    if (!outlet) return deny(400, 'Outlet tidak ditemukan.');
    const lock = await lockedPeriodFor(db, outletId);
    if (lock) return deny(409, lockedMsg(lock));

    if (requisitionId) {
      const { data: dup, error: dupErr } = await db.from('expenses').select('id').eq('requisition_id', requisitionId).limit(1);
      if (!dupErr && dup?.[0]) return NextResponse.json({ ok: true, already: true, id: dup[0].id }, { headers: noStore });
    }

    const base = { outlet_id: outletId, category, amount, description };
    const sourced = paidFrom ? { ...base, paid_from: paidFrom } : base;
    const { data, error } = await insertWithFallbackOn<{ id: string }>(
      db,
      'expenses',
      [
        {
          ...sourced,
          notes: requisitionId ? description : undefined,
          requisition_id: requisitionId || undefined,
          proof_url: proofUrl || undefined,
          status: requisitionId ? 'PAID' : undefined,
          created_by: me.staff.name || me.staff.id
        },
        sourced,
        base
      ],
      { select: 'id' }
    );
    if (error) throw new Error(error.message);
    const id = data?.[0]?.id || null;
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: 'expense_created',
      entity_type: 'expenses',
      entity_id: id,
      amount,
      meta: { outlet_id: outletId, category, paid_from: paidFrom || null, requisition_id: requisitionId || null },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true, id }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'staff_expense', code: 'EXPENSE_SAVE_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Pengeluaran belum tersimpan. Coba lagi sebentar lagi.');
  }
}
