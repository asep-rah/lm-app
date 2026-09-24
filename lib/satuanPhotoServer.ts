/**
 * Konfigurasi fitur foto item satuan. Import ONLY from API routes (server).
 *
 * Fitur hanya aktif bila SEMUA syarat keamanan terpenuhi — tanpa itu foto
 * tidak diminta dari customer dan tidak bisa dibuka staf:
 * - SATUAN_ITEM_PHOTO_ENABLED=true (default mati)
 * - SUPABASE_SERVICE_ROLE_KEY (bucket tanpa policy anon; semua lewat server)
 * - CUSTOMER_AUTH_SECRET ≥ 32 (sesi customer terverifikasi + folder pemilik)
 * - STAFF_SESSION_SECRET ≥ 32 (identitas staf terverifikasi untuk melihat foto)
 *
 * PRODUKSI: selalu mati, apa pun env-nya. Dibuka lewat perubahan kode yang
 * direview setelah (1) otorisasi staf ditinjau, (2) kewajiban foto ditegakkan
 * di server saat pesanan dibuat, dan (3) uji staging selesai.
 */
import { staffSessionSecret } from '@/lib/staffAuth/server';
import { serverDeployEnv, serverServiceKey } from '@/lib/supabaseServer';
export { SATUAN_ITEM_PHOTO_BUCKET } from '@/lib/satuanItemPhoto';

export const SATUAN_PHOTO_PRODUCTION_RELEASED = false;

export const satuanPhotoConfig = () => {
  const flag = ['true', '1', 'yes'].includes(String(process.env.SATUAN_ITEM_PHOTO_ENABLED || '').trim().toLowerCase());
  const ownerSecret = String(process.env.CUSTOMER_AUTH_SECRET || '').trim();
  const hasServiceRole = Boolean(serverServiceKey());
  const allowedHere = serverDeployEnv() !== 'production' || SATUAN_PHOTO_PRODUCTION_RELEASED;
  const enabled = allowedHere && flag && hasServiceRole && ownerSecret.length >= 32 && Boolean(staffSessionSecret());
  return { enabled, ownerSecret: enabled ? ownerSecret : '' };
};
