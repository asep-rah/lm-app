/**
 * Bukti foto: coba Storage singkat, selalu fallback ke data URL terkompresi.
 * Tanpa bucket / 403 / 404 tidak boleh gagal.
 */

const MAX_DATA_CHARS = 140_000;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const out = String(reader.result || '');
      if (!out) reject(new Error('File kosong'));
      else resolve(out);
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(blob);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });

const canvasToJpeg = (img: HTMLImageElement, edge: number, quality: number) => {
  let w = img.naturalWidth || img.width || 1;
  let h = img.naturalHeight || img.height || 1;
  if (w > edge || h > edge) {
    const scale = edge / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
};

/** JPEG data URL cukup kecil untuk kolom Postgres text + payload PostgREST. */
export async function fileToCompressedDataUrl(file: File): Promise<string> {
  if (typeof window === 'undefined') {
    return readAsDataUrl(file);
  }
  try {
    const raw = await readAsDataUrl(file);
    if (!file.type.startsWith('image/') || file.type.includes('gif') || file.type.includes('svg')) {
      return raw.length > MAX_DATA_CHARS ? raw.slice(0, MAX_DATA_CHARS) : raw;
    }
    const img = await loadImage(raw);
    const passes: Array<{ edge: number; quality: number }> = [
      { edge: 960, quality: 0.62 },
      { edge: 720, quality: 0.5 },
      { edge: 560, quality: 0.4 },
      { edge: 420, quality: 0.32 }
    ];
    let best = '';
    for (const p of passes) {
      const next = canvasToJpeg(img, p.edge, p.quality);
      if (!next) continue;
      best = next;
      if (next.length <= MAX_DATA_CHARS) return next;
    }
    return best || raw;
  } catch {
    try {
      return await readAsDataUrl(file);
    } catch {
      return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    }
  }
}

const tryStorageUpload = async (file: File, prefix: string): Promise<string | null> => {
  try {
    const { supabase } = await import('@/lib/supabaseClient');
    const fileName = `${prefix}_${Date.now()}.jpg`;
    const buckets = ['laundry-proofs', 'outlet-issues'];
    for (const bucket of buckets) {
      const { error } = await supabase.storage.from(bucket).upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true
      });
      if (error) {
        const msg = String(error.message || error).toLowerCase();
        if (msg.includes('403') || msg.includes('404') || msg.includes('not found') || msg.includes('unauthorized') || msg.includes('row-level')) {
          return null;
        }
        continue;
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      if (data?.publicUrl?.startsWith('http')) return data.publicUrl;
    }
  } catch {
    return null;
  }
  return null;
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  ]);

/**
 * Coba Storage 2.5s; apa pun hasilnya (error/403/timeout) → data URL terkompresi.
 * Fungsi ini tidak melempar.
 */
export async function uploadProofFile(file: File, prefix: string): Promise<string> {
  try {
    const stored = await withTimeout(tryStorageUpload(file, prefix), 2500);
    if (stored && stored.startsWith('http')) return stored;
  } catch {
    /* bucket tidak dikonfigurasi / 403 / jaringan */
  }
  return fileToCompressedDataUrl(file);
}

export const uploadChatAttachment = uploadProofFile;
export const confirmPaymentProof = uploadProofFile;
