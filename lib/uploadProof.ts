import { supabase } from '@/lib/supabaseClient';

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.72;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(blob);
  });

const compressImageFile = async (file: File): Promise<Blob> => {
  if (typeof window === 'undefined') return file;
  if (!file.type.startsWith('image/') || file.type.includes('gif') || file.type.includes('svg')) {
    return file;
  }
  try {
    const dataUrl = await readAsDataUrl(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = dataUrl;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > MAX_EDGE || h > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;
    if (blob.size >= file.size && file.size < 700_000) return file;
    return blob;
  } catch {
    return file;
  }
};

const tryStorageUpload = async (file: File, prefix: string): Promise<string | null> => {
  const ext = file.type.includes('png') ? 'png' : file.type.includes('pdf') ? 'pdf' : 'jpg';
  const fileName = `${prefix}_${Date.now()}.${ext}`;
  const buckets = ['laundry-proofs', 'outlet-issues'];
  for (const bucket of buckets) {
    try {
      const { error } = await supabase.storage.from(bucket).upload(fileName, file, {
        contentType: file.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg'),
        upsert: true
      });
      if (error) continue;
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      if (data?.publicUrl) return data.publicUrl;
    } catch {
      /* unauthorized / network — coba bucket berikutnya atau data URL */
    }
  }
  return null;
};

/** Unggah ke Storage; bila gagal (unauthorized dll) pakai data URL inline. */
export async function uploadProofFile(file: File, prefix: string): Promise<string> {
  const compressed = await compressImageFile(file);
  const uploadFile =
    compressed instanceof File
      ? compressed
      : new File([compressed], `${prefix}.jpg`, { type: compressed.type || 'image/jpeg' });

  const stored = await tryStorageUpload(uploadFile, prefix);
  if (stored) return stored;

  return readAsDataUrl(uploadFile);
}

export const uploadChatAttachment = uploadProofFile;
export const confirmPaymentProof = uploadProofFile;
