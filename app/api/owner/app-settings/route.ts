import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { updateWithFallbackOn } from '@/lib/safeWrite';
import { APP_SETTINGS_KEY_PERMISSION, permissionLabel, planAppSettingsWrite } from '@/lib/accessControl';
import { requireStaff } from '@/lib/staffAuth/owner';
import { permissionsOfStaff } from '@/lib/staffAuth/permissions';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/** Kolom app_settings yang boleh diubah dari aplikasi (harga, bagi hasil, buku outlet, voucher, struk, COA). */
const KNOWN_KEYS = new Set(Object.keys(APP_SETTINGS_KEY_PERMISSION));
const MAX_BYTES = 900_000;

/**
 * Simpan app_settings (baris id=1) dari server. Browser tidak lagi bisa menulis
 * app_settings. Body: { attempts: [{...kolom}, ...] } dari lengkap ke minimal
 * (kolom opsional yang belum ada di DB lama).
 *
 * Hak dicek per PERUBAHAN (lib/accessControl.ts): kolom yang nilainya sama
 * dengan di DB tidak butuh hak, jadi Supervisor bisa menyimpan halaman
 * pengaturan tanpa ikut "mengubah" gaji pokok. Kunci milik fitur lain di
 * outlet_overrides yang tidak boleh ia ubah dikembalikan ke nilai DB.
 * Tercatat di audit_logs (nama kolom & hak, bukan isi).
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
    const bad = keys.find((k) => !KNOWN_KEYS.has(k));
    if (bad) return deny(400, `Kolom pengaturan tidak dikenal: ${bad.slice(0, 40)}`);
    clean.push(a as Record<string, unknown>);
  }
  if (!clean.length) return deny(400, 'Tidak ada pengaturan yang disimpan.');

  try {
    const db = paymentServiceDb();
    const me = await requireStaff(req, db);
    if ('error' in me) return me.error;
    const perms = await permissionsOfStaff(db, me.staff.role);
    const { data: current } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
    const plans = clean.map((a) => planAppSettingsWrite(a, current as Record<string, unknown> | null, perms));
    const needed = plans[0].needed;
    const missing = needed.filter((p) => !perms.has(p));
    if (missing.length) {
      return NextResponse.json(
        { error: `Peran Anda belum diberi hak: ${missing.map(permissionLabel).join(', ')}. Minta owner mengaturnya di Hak Akses.`, code: 'PERMISSION_DENIED' },
        { status: 403, headers: noStore }
      );
    }
    if (!needed.length) return NextResponse.json({ ok: true, unchanged: true }, { headers: noStore });

    const { error } = await updateWithFallbackOn(db, 'app_settings', plans.map((p) => p.row), { column: 'id', value: 1 });
    if (error) throw new Error(error.message);
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: 'app_settings_updated',
      entity_type: 'app_settings',
      entity_id: '1',
      meta: { keys: Object.keys(plans[0].row), permissions: needed },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'app_settings', code: 'APP_SETTINGS_SAVE_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Pengaturan belum tersimpan. Coba lagi sebentar lagi.');
  }
}
