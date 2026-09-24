/**
 * Foto wajib item satuan — sisi browser.
 *
 * Browser TIDAK punya akses langsung ke bucket (tanpa policy anon):
 * - unggah: minta signed upload URL ke /api/customer/satuan-photo/upload-url
 *   (butuh sesi customer terverifikasi), lalu kirim file ke URL itu;
 * - lihat (staf): /api/staff/satuan-photo/view (butuh sesi staf terverifikasi).
 * Kegagalan di langkah mana pun dilempar sebagai error — tidak pernah
 * dianggap berhasil. Lihat supabase/migrations/20260924_satuan_item_photos.sql.
 */
import { compressImageToBlob } from '@/lib/uploadProof';

export const SATUAN_ITEM_PHOTO_BUCKET = 'satuan-item-photos';

export type SatuanPhotoUploadResult = { path: string; previewUrl: string };
export type SatuanPhotoConfig = { enabled: boolean; canUpload: boolean };

/** Pure guard — testable tanpa DOM/File API asli. */
export const isImageFileLike = (file: { type?: string } | null | undefined): boolean =>
  Boolean(file && String(file.type || '').startsWith('image/'));

/**
 * Status fitur dari server. Bila server tidak bisa dihubungi, anggap foto
 * wajib tetapi belum bisa diunggah (fail-closed) — customer diminta memuat
 * ulang, bukan dilewatkan tanpa foto.
 */
export async function fetchSatuanPhotoConfig(): Promise<SatuanPhotoConfig> {
  try {
    const res = await fetch('/api/customer/satuan-photo/config', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    return { enabled: Boolean(j?.enabled), canUpload: Boolean(j?.canUpload) };
  } catch {
    return { enabled: true, canUpload: false };
  }
}

const serverError = async (res: Response, fallback: string) => {
  try {
    const j = await res.json();
    return typeof j?.error === 'string' && j.error ? j.error : fallback;
  } catch {
    return fallback;
  }
};

const UPLOAD_FAILED = 'Gagal mengunggah foto. Periksa koneksi internet Anda dan coba lagi.';

/**
 * Mengunggah satu foto item satuan. MELEMPAR error bila gagal — pemanggil
 * wajib menanganinya sebagai kegagalan sungguhan.
 */
export async function uploadSatuanItemPhoto(file: File): Promise<SatuanPhotoUploadResult> {
  if (!isImageFileLike(file)) {
    throw new Error('File harus berupa foto (JPG/PNG).');
  }
  let res: Response;
  try {
    res = await fetch('/api/customer/satuan-photo/upload-url', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch {
    throw new Error(UPLOAD_FAILED);
  }
  if (!res.ok) throw new Error(await serverError(res, UPLOAD_FAILED));
  const { path, token } = (await res.json().catch(() => ({}))) as { path?: string; token?: string };
  if (!path || !token) throw new Error(UPLOAD_FAILED);

  const blob = await compressImageToBlob(file, { edge: 1280, quality: 0.72 });
  const { supabase } = await import('@/lib/supabaseClient');
  const { error } = await supabase.storage
    .from(SATUAN_ITEM_PHOTO_BUCKET)
    .uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(UPLOAD_FAILED);
  // Pratinjau lokal — dicabut pemanggil (URL.revokeObjectURL) saat diganti/dihapus.
  return { path, previewUrl: URL.createObjectURL(file) };
}

/**
 * Aturan wajib foto: item satuan (satu baris keranjang) hanya lolos bila
 * SETIAP potong pada baris itu punya photo_path.
 */
export const satuanItemHasRequiredPhotos = (item: { pieces?: Array<{ photo_path?: string | null }> | null }): boolean =>
  Array.isArray(item?.pieces) && item.pieces.length > 0 && item.pieces.every((p) => Boolean(p?.photo_path));

/** URL sementara (5 menit) untuk staf — atau pesan error yang bisa ditampilkan. */
export async function staffSatuanPhotoUrl(
  pickupOrderId: string,
  path: string
): Promise<{ url: string } | { error: string }> {
  try {
    const res = await fetch('/api/staff/satuan-photo/view', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickupOrderId, path })
    });
    if (!res.ok) return { error: await serverError(res, 'Gagal memuat foto.') };
    const j = await res.json();
    return typeof j?.url === 'string' ? { url: j.url } : { error: 'Gagal memuat foto.' };
  } catch {
    return { error: 'Gagal memuat foto. Periksa koneksi.' };
  }
}
