import { supabase } from '@/lib/supabaseClient';

export async function uploadProofFile(file: File, prefix: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
  const fileName = `${prefix}_${Date.now()}.${ext}`;
  const buckets = ['laundry-proofs', 'outlet-issues'];
  for (const bucket of buckets) {
    const { error } = await supabase.storage.from(bucket).upload(fileName, file);
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      if (data?.publicUrl) return data.publicUrl;
    }
  }
  throw new Error('Gagal mengunggah foto bukti');
}
