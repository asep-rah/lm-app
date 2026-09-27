import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { updateWithFallbackOn } from '@/lib/safeWrite';
import { requireStaff } from '@/lib/staffAuth/owner';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/** Kolom app_settings yang boleh diubah dari aplikasi (harga, bagi hasil, buku outlet, voucher, struk, COA). */
const OWNER_KEYS = new Set([
  'basic_salary',
  'receipt_terms',
  'receipt_layout',
  'coa_categories',
  'dynamic_services',
  'outlet_overrides',
  'supervisor_mapping',
  'voucher_programs',
  'promos_data',
  'profit_share_by_outlet',
  'outlet_books'
]);
/** Tim keuangan (Finance Workspace) hanya boleh mengelola daftar COA. */
const FINANCE_ROLES = ['supervisor', 'finance', 'head_finance', 'head', 'head_management'];
const FINANCE_KEYS = new Set(['coa_categories']);
const MAX_BYTES = 900_000;

/**
 * Simpan app_settings (baris id=1) dari server. Browser tidak lagi bisa menulis
 * app_settings (harga layanan, persen bagi hasil, saldo awal buku, voucher).
 * Body: { attempts: [{...kolom}, ...] } dari lengkap ke minimal (kolom opsional
 * yang belum ada di DB lama). Owner: semua kolom di atas; tim keuangan: COA saja.
 * Tercatat di audit_logs (nama kolom, bukan isi).
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const raw = await req.text().catch(() => '');
  if (raw.length > MAX_BYTES) return deny(413, 'Pengaturan terlalu besar.');
  let body: { attempts?: unknown };
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return deny(400, 'Format pengaturan tidak valid.');
  }
  const attempts = Array.isArray(body.attempts) ? body.attempts : [];
  if (!attempts.length || attempts.length > 8) return deny(400, 'Tidak ada pengaturan yang disimpan.');
  const clean: Record<string, unknown>[] = [];
  for (const a of attempts) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return deny(400, 'Format pengaturan tidak valid.');
    const keys = Object.keys(a);
    if (!keys.length) continue;
    const bad = keys.find((k) => !OWNER_KEYS.has(k));
    if (bad) return deny(400, `Kolom pengaturan tidak dikenal: ${bad.slice(0, 40)}`);
    clean.push(a as Record<string, unknown>);
  }
  if (!clean.length) return deny(400, 'Tidak ada pengaturan yang disimpan.');
  const keys = [...new Set(clean.flatMap((a) => Object.keys(a)))];
  const financeOnly = keys.every((k) => FINANCE_KEYS.has(k));

  try {
    const db = paymentServiceDb();
    const me = await requireStaff(req, db, financeOnly ? ['owner', ...FINANCE_ROLES] : ['owner'], 'Hanya owner yang boleh mengubah pengaturan ini.');
    if ('error' in me) return me.error;
    const { error } = await updateWithFallbackOn(db, 'app_settings', clean, { column: 'id', value: 1 });
    if (error) throw new Error(error.message);
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: 'app_settings_updated',
      entity_type: 'app_settings',
      entity_id: '1',
      meta: { keys },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'app_settings', code: 'APP_SETTINGS_SAVE_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Pengaturan belum tersimpan. Coba lagi sebentar lagi.');
  }
}
