import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { requirePermission } from '@/lib/staffAuth/permissions';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = 'finance_period_locks';

/** Tanggal terakhir bulan dari 'YYYY-MM' / 'YYYY-MM-DD'. */
const monthEnd = (raw: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(raw);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || y < 2020) return '';
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

/**
 * Tutup buku per outlet (owner). Transaksi / pengeluaran / top up bertanggal
 * pada atau sebelum tanggal kunci tidak bisa ditambah atau diubah nilainya dari
 * aplikasi (trigger guard_finance_period). Membuka kunci (mundur) wajib alasan.
 * Semua perubahan tercatat di audit_logs.
 */
export async function GET(req: NextRequest) {
  try {
    const db = paymentServiceDb();
    const me = await requirePermission(req, db, ['period.lock', 'view.finance_reports']);
    if ('error' in me) return me.error;
    const { data, error } = await db.from(TABLE).select('*');
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
    return NextResponse.json({ locks: data || [] }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'period_lock', code: 'PERIOD_LOCK_LIST_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Status tutup buku belum bisa dimuat.');
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const outletId = String(body.outletId || '');
  if (!UUID.test(outletId)) return deny(400, 'Pilih satu outlet.');
  const through = monthEnd(String(body.month || ''));
  if (!through) return deny(400, 'Bulan tidak valid.');
  const now = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  if (through >= now) return deny(400, 'Bulan berjalan belum bisa ditutup. Tutup buku setelah bulan berakhir.');
  const reason = String(body.reason || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);

  try {
    const db = paymentServiceDb();
    const me = await requirePermission(req, db, 'period.lock');
    if ('error' in me) return me.error;
    const { data: outlet } = await db.from('outlets').select('id, name').eq('id', outletId).maybeSingle();
    if (!outlet) return deny(400, 'Outlet tidak ditemukan.');
    const { data: current } = await db.from(TABLE).select('*').eq('outlet_id', outletId).maybeSingle();
    const previous = current?.locked_through ? String(current.locked_through).slice(0, 10) : null;
    const reopening = previous !== null && through < previous;
    if (reopening && reason.length < 3) return deny(400, 'Membuka kembali periode yang sudah ditutup wajib menulis alasan.');

    const row = { outlet_id: outletId, locked_through: through, updated_at: new Date().toISOString(), updated_by: me.staff.name || me.staff.id, note: reason || null };
    const write = current
      ? await db.from(TABLE).update(row).eq('outlet_id', outletId)
      : await db.from(TABLE).insert([row]);
    if (write.error) throw new Error(`${write.error.code ?? ''} ${write.error.message}`.trim());

    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: reopening ? 'finance_period_reopened' : 'finance_period_locked',
      entity_type: TABLE,
      entity_id: outletId,
      meta: { outlet: outlet.name, from: previous, to: through, reason: reason || null },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ lock: row }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'period_lock', code: 'PERIOD_LOCK_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Tutup buku belum tersimpan. Coba lagi sebentar lagi.');
  }
}
