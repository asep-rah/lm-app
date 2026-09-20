/**
 * Token approval sekali pakai untuk balasan WhatsApp.
 *
 * Approval lewat WhatsApp menyentuh area yang dilindungi AGENTS.md (uang +
 * otorisasi). Syarat minimalnya, dan alasannya:
 *
 *   1. Token sekali pakai berumur pendek, bukan sekadar balas "YA" — pesan
 *      "YA" bisa datang dari siapa pun yang tahu formatnya.
 *   2. Nomor pengirim diverifikasi terhadap employees.whatsapp — token yang
 *      bocor tetap tidak bisa dipakai dari nomor lain.
 *   3. Setiap keputusan tercatat aktor dan waktunya di audit_logs.
 *   4. Kegagalan verifikasi berarti TOLAK, bukan lanjut.
 *
 * Yang disimpan adalah hash token, bukan tokennya: isi tabel yang bocor tidak
 * langsung bisa dipakai menyetujui apa pun.
 *
 * Server-only — memakai service role.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { paymentServiceDb } from '@/lib/paymentSecurity';

export const APPROVAL_PURPOSE = {
  REQUISITION_APPROVAL: 'requisition_approval'
} as const;

/** Umur token. Cukup untuk membalas WhatsApp, tidak cukup untuk disalahgunakan berhari-hari. */
export const TOKEN_TTL_MINUTES = 60;

export const hashToken = (raw: string) =>
  createHash('sha256').update(String(raw || '').trim()).digest('hex');

/**
 * Nomor WhatsApp ke format 62xxxxxxxxxx.
 *
 * Nomor yang sama bisa datang sebagai 08xx, +628xx, 628xx, atau
 * 628xx@s.whatsapp.net dari Evolution API. Perbandingan tanpa normalisasi akan
 * menolak owner yang sah.
 */
export const normalizePhone = (raw: string | null | undefined): string => {
  let s = String(raw || '').trim().toLowerCase();
  s = s.split('@')[0];
  s = s.replace(/[^\d+]/g, '');
  s = s.replace(/^\+/, '');
  if (s.startsWith('0')) s = `62${s.slice(1)}`;
  if (s.startsWith('8')) s = `62${s}`;
  return s;
};

export const phonesMatch = (a: string | null | undefined, b: string | null | undefined) => {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na.length !== nb.length) return false;
  try {
    return timingSafeEqual(Buffer.from(na), Buffer.from(nb));
  } catch {
    return na === nb;
  }
};

export const isExpired = (expiresAt: string | null | undefined, now = Date.now()) => {
  const t = new Date(String(expiresAt || '')).getTime();
  if (isNaN(t)) return true; // tanggal tidak terbaca = anggap kedaluwarsa
  return t <= now;
};

/** Keputusan yang bisa diambil dari balasan WhatsApp. */
export const APPROVAL_DECISIONS = ['approve', 'reject'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

const APPROVE_WORDS = ['approve', 'setuju', 'ya', 'yes', 'ok'];
const REJECT_WORDS = ['reject', 'tolak', 'no', 'tidak'];

/**
 * Baca keputusan dari balasan WhatsApp.
 *
 * Kecocokan harus PERSIS satu kata, bukan "mengandung". Balasan seperti
 * "jangan disetujui dulu" mengandung kata "setuju"; membacanya sebagai
 * persetujuan berarti mengeluarkan uang atas kalimat yang artinya sebaliknya.
 * Yang tidak dikenali dikembalikan null supaya pemanggil menolak, bukan menebak.
 */
export const parseApprovalDecision = (raw: unknown): ApprovalDecision | null => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (APPROVE_WORDS.includes(s)) return 'approve';
  if (REJECT_WORDS.includes(s)) return 'reject';
  return null;
};

export type TokenRow = {
  id: string;
  purpose: string;
  entity_type: string;
  entity_id: string;
  issued_to_phone: string;
  issued_to_name: string | null;
  expires_at: string;
  used_at: string | null;
};

/**
 * Terbitkan token dan kembalikan bentuk MENTAH-nya sekali saja.
 *
 * Pemanggil (n8n) yang mengirimkannya lewat WhatsApp; aplikasi tidak
 * menyimpannya dalam bentuk yang bisa dibaca ulang.
 */
export const issueApprovalToken = async (opts: {
  purpose: string;
  entityType: string;
  entityId: string;
  phone: string;
  name?: string | null;
  ttlMinutes?: number;
}): Promise<{ token: string | null; expiresAt: string | null; error: string | null }> => {
  const phone = normalizePhone(opts.phone);
  if (!phone) return { token: null, expiresAt: null, error: 'Nomor tujuan tidak valid' };

  const raw = randomBytes(24).toString('base64url');
  const expiresAt = new Date(
    Date.now() + (opts.ttlMinutes ?? TOKEN_TTL_MINUTES) * 60_000
  ).toISOString();

  const { error } = await paymentServiceDb()
    .from('approval_tokens')
    .insert([
      {
        token_hash: hashToken(raw),
        purpose: opts.purpose,
        entity_type: opts.entityType,
        entity_id: String(opts.entityId),
        issued_to_phone: phone,
        issued_to_name: opts.name || null,
        expires_at: expiresAt
      }
    ]);

  if (error) return { token: null, expiresAt: null, error: error.message };
  return { token: raw, expiresAt, error: null };
};

export type ConsumeResult =
  | { ok: true; row: TokenRow }
  | { ok: false; reason: string };

/**
 * Pakai token satu kali.
 *
 * Penandaan "terpakai" memakai satu pernyataan UPDATE ... WHERE used_at IS NULL
 * sehingga dua balasan yang datang bersamaan tidak bisa dua-duanya berhasil.
 * Memeriksa dulu lalu menandai belakangan akan membuka balapan itu.
 */
export const consumeApprovalToken = async (opts: {
  token: string;
  fromPhone: string;
  purpose: string;
  decision: string;
}): Promise<ConsumeResult> => {
  const raw = String(opts.token || '').trim();
  if (!raw) return { ok: false, reason: 'Token kosong' };

  const db = paymentServiceDb();
  const hash = hashToken(raw);

  const { data: found, error: findErr } = await db
    .from('approval_tokens')
    .select('id, purpose, entity_type, entity_id, issued_to_phone, issued_to_name, expires_at, used_at')
    .eq('token_hash', hash)
    .limit(1);

  if (findErr) return { ok: false, reason: `Gagal memeriksa token: ${findErr.message}` };
  const row = (found || [])[0] as TokenRow | undefined;
  if (!row) return { ok: false, reason: 'Token tidak dikenali' };
  if (row.used_at) return { ok: false, reason: 'Token sudah dipakai' };
  if (row.purpose !== opts.purpose) return { ok: false, reason: 'Token bukan untuk keperluan ini' };
  if (isExpired(row.expires_at)) return { ok: false, reason: 'Token kedaluwarsa' };
  if (!phonesMatch(row.issued_to_phone, opts.fromPhone)) {
    return { ok: false, reason: 'Nomor pengirim tidak cocok dengan penerima token' };
  }

  const { data: claimed, error: claimErr } = await db
    .from('approval_tokens')
    .update({
      used_at: new Date().toISOString(),
      used_by_phone: normalizePhone(opts.fromPhone),
      decision: opts.decision
    })
    .eq('token_hash', hash)
    .is('used_at', null)
    .select('id');

  if (claimErr) return { ok: false, reason: `Gagal menandai token: ${claimErr.message}` };
  if (!claimed?.length) return { ok: false, reason: 'Token sudah dipakai' };

  return { ok: true, row };
};
