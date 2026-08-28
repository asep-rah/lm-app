import { supabase } from '@/lib/supabaseClient';

const cleanRow = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));

/**
 * Insert dengan urutan payload dari lengkap ke minimal.
 * Kolom opsional yang belum ada di schema live tidak boleh menolak seluruh baris.
 */
export async function insertWithFallback<T = Record<string, unknown>>(
  table: string,
  attempts: Record<string, unknown>[],
  { select }: { select?: string } = {}
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  let lastErr: { message: string } | null = null;
  for (const row of attempts) {
    const clean = cleanRow(row);
    const q = supabase.from(table).insert([clean]);
    const { data, error } = select ? await q.select(select) : await q.select();
    if (!error) return { data: ((data || []) as unknown as T[]), error: null };
    lastErr = { message: error.message };
  }
  return { data: null, error: lastErr || { message: `Gagal insert ${table}` } };
}
