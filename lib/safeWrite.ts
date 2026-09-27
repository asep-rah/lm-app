import { supabase } from '@/lib/supabaseClient';

const cleanRow = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));

const toErr = (e: unknown): { message: string } => {
  if (e && typeof e === 'object' && 'message' in e && (e as { message?: unknown }).message) {
    return { message: String((e as { message: unknown }).message) };
  }
  return { message: String(e || 'Failed to fetch') };
};

/**
 * Insert dengan urutan payload dari lengkap ke minimal.
 * Kolom opsional yang belum ada di schema live tidak boleh menolak seluruh baris.
 * TypeError "Failed to fetch" (jaringan) ditangkap per-attempt, bukan dilempar ke pemanggil.
 */
export async function insertWithFallback<T = Record<string, unknown>>(
  table: string,
  attempts: Record<string, unknown>[],
  opts: { select?: string } = {}
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  return insertWithFallbackOn<T>(supabase, table, attempts, opts);
}

/** Sama dengan insertWithFallback, tetapi memakai klien yang diberikan (mis. service role di server). */
export async function insertWithFallbackOn<T = Record<string, unknown>>(
  db: WriteDb,
  table: string,
  attempts: Record<string, unknown>[],
  { select }: { select?: string } = {}
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  let lastErr: { message: string } | null = null;
  for (const row of attempts) {
    const clean = cleanRow(row);
    try {
      const q = db.from(table).insert([clean]);
      const { data, error } = select ? await q.select(select) : await q.select();
      if (!error) return { data: ((data || []) as unknown as T[]), error: null };
      lastErr = { message: error.message };
    } catch (e) {
      lastErr = toErr(e);
    }
  }
  return { data: null, error: lastErr || { message: `Gagal insert ${table}` } };
}

/**
 * Update dengan urutan payload dari lengkap ke minimal.
 * Kolom opsional yang belum ada di schema live tidak boleh menolak seluruh baris.
 */
export async function updateWithFallback(
  table: string,
  attempts: Record<string, unknown>[],
  match: { column: string; value: unknown }
): Promise<{ error: { message: string } | null }> {
  return updateWithFallbackOn(supabase, table, attempts, match);
}

/** Klien Supabase apa pun (browser anon atau server service role). */
export type WriteDb = Pick<typeof supabase, 'from'>;

/** Sama dengan updateWithFallback, tetapi memakai klien yang diberikan (mis. service role di server). */
export async function updateWithFallbackOn(
  db: WriteDb,
  table: string,
  attempts: Record<string, unknown>[],
  match: { column: string; value: unknown }
): Promise<{ error: { message: string } | null }> {
  let lastErr: { message: string } | null = null;
  for (const row of attempts) {
    const clean = cleanRow(row);
    if (Object.keys(clean).length === 0) continue;
    try {
      const { error } = await db.from(table).update(clean).eq(match.column, match.value);
      if (!error) return { error: null };
      lastErr = { message: error.message };
    } catch (e) {
      lastErr = toErr(e);
    }
  }
  return { error: lastErr || { message: `Gagal update ${table}` } };
}
