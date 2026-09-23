/**
 * Foto wajib item satuan (customer order form). Berbeda sengaja dari
 * lib/uploadProof.ts's uploadProofFile(): fungsi itu SELALU "berhasil" (jatuh
 * ke data URL tersemat bila Storage gagal) dan memakai bucket PUBLIK — cocok
 * untuk bukti operasional yang toleran terhadap Storage belum terkonfigurasi,
 * tapi TIDAK cocok untuk syarat "wajib foto, jangan anggap gagal sebagai
 * berhasil, jangan jadi tautan publik" di form pemesanan customer. Lihat
 * migrasi supabase/migrations/20260924_satuan_item_photos.sql untuk bucket +
 * kebijakan RLS-nya, termasuk batasan yang didokumentasikan di sana.
 */
import { compressImageToBlob } from '@/lib/uploadProof';

export const SATUAN_ITEM_PHOTO_BUCKET = 'satuan-item-photos';
export const SATUAN_ITEM_PHOTO_SIGNED_URL_TTL_SEC = 3600;

export type SatuanPhotoUploadResult = { path: string; previewUrl: string };

const randomSuffix = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

/** Pure guard — testable tanpa DOM/File API asli. */
export const isImageFileLike = (file: { type?: string } | null | undefined): boolean =>
  Boolean(file && String(file.type || '').startsWith('image/'));

/** Nama file storage aman — huruf/angka/underscore/dash saja, dipakai juga untuk tes. */
export const safeSatuanPhotoPrefix = (raw: string): string =>
  String(raw || 'item').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'item';

/**
 * Mengunggah satu foto item satuan ke bucket privat. MELEMPAR error bila
 * gagal — pemanggil wajib menangani reject sebagai kegagalan sungguhan
 * (jangan disimpan sebagai "berhasil" bila fungsi ini reject).
 */
export async function uploadSatuanItemPhoto(file: File, prefix: string): Promise<SatuanPhotoUploadResult> {
  if (!isImageFileLike(file)) {
    throw new Error('File harus berupa foto (JPG/PNG).');
  }
  const { supabase } = await import('@/lib/supabaseClient');
  const blob = await compressImageToBlob(file, { edge: 1280, quality: 0.72 });
  const path = `${safeSatuanPhotoPrefix(prefix)}_${Date.now()}_${randomSuffix()}.jpg`;
  const { error } = await supabase.storage
    .from(SATUAN_ITEM_PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    throw new Error('Gagal mengunggah foto. Periksa koneksi internet Anda dan coba lagi.');
  }
  // Pratinjau lokal instan (tidak butuh round-trip) — dicabut oleh pemanggil
  // (URL.revokeObjectURL) saat foto diganti/dihapus.
  return { path, previewUrl: URL.createObjectURL(file) };
}

/**
 * Aturan wajib foto: item satuan (satu baris keranjang) hanya lolos bila
 * SETIAP potong pada baris itu punya photo_path. Satu baris = satu atau lebih
 * "pieces"; qty > 1 tanpa pieces terisi (data lama/rusak) juga gagal.
 */
export const satuanItemHasRequiredPhotos = (item: { pieces?: Array<{ photo_path?: string | null }> | null }): boolean =>
  Array.isArray(item?.pieces) && item.pieces.length > 0 && item.pieces.every((p) => Boolean(p?.photo_path));

/**
 * URL sementara (kedaluwarsa, ~1 jam) untuk menampilkan foto ke staf —
 * BUKAN tautan publik permanen. Mengembalikan null bila gagal (pemanggil
 * menampilkan pesan "gagal memuat foto", bukan gambar kosong dianggap oke).
 */
export async function signedSatuanItemPhotoUrl(
  path: string,
  ttlSeconds: number = SATUAN_ITEM_PHOTO_SIGNED_URL_TTL_SEC
): Promise<string | null> {
  if (!path) return null;
  try {
    const { supabase } = await import('@/lib/supabaseClient');
    const { data, error } = await supabase.storage.from(SATUAN_ITEM_PHOTO_BUCKET).createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
