/**
 * Konfigurasi fitur foto item satuan. Import ONLY from API routes (server).
 *
 * Fitur hanya aktif bila SEMUA syarat keamanan terpenuhi — tanpa itu foto
 * tidak diminta dari customer dan tidak bisa dibuka staf:
 * - SATUAN_ITEM_PHOTO_ENABLED=true (default mati)
 * - SUPABASE_SERVICE_ROLE_KEY (bucket tanpa policy anon; semua lewat server)
 * - CUSTOMER_AUTH_SECRET ≥ 32 (sesi customer terverifikasi + folder pemilik)
 * - STAFF_SESSION_SECRET ≥ 32 (identitas staf terverifikasi untuk melihat foto)
 */
import { staffSessionSecret } from '@/lib/staffAuth/server';
export { SATUAN_ITEM_PHOTO_BUCKET } from '@/lib/satuanItemPhoto';

export const satuanPhotoConfig = () => {
  const flag = ['true', '1', 'yes'].includes(String(process.env.SATUAN_ITEM_PHOTO_ENABLED || '').trim().toLowerCase());
  const ownerSecret = String(process.env.CUSTOMER_AUTH_SECRET || '').trim();
  const hasServiceRole = Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
  const enabled = flag && hasServiceRole && ownerSecret.length >= 32 && Boolean(staffSessionSecret());
  return { enabled, ownerSecret: enabled ? ownerSecret : '' };
};
