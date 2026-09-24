/**
 * Klasifikasi & sanitasi error pembuatan pesanan (pure — dipakai client dan
 * server). Tujuannya: cukup untuk diagnosa, tanpa data pribadi pelanggan.
 */

export type OrderErrorCategory = 'not_null' | 'network' | 'duplicate' | 'permission' | 'schema' | 'unknown';

export const ORDER_ERROR_CATEGORIES: ReadonlySet<string> = new Set([
  'not_null',
  'network',
  'duplicate',
  'permission',
  'schema',
  'unknown'
]);

export const classifyOrderError = (raw?: string | null): OrderErrorCategory => {
  const msg = String(raw || '').toLowerCase();
  if (msg.includes('not-null constraint') || msg.includes('null value')) return 'not_null';
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) return 'network';
  if (msg.includes('duplicate') || msg.includes('unique constraint')) return 'duplicate';
  if (msg.includes('permission denied') || msg.includes('row-level security')) return 'permission';
  if (msg.includes('schema cache') || msg.includes('does not exist')) return 'schema';
  return 'unknown';
};

/** Nama kolom/relasi dari pesan Postgres (identifier saja, bukan nilai). */
export const orderErrorColumnOf = (raw?: string | null): string | null => {
  const m = String(raw || '').match(/column "([a-z_][a-z0-9_]{0,62})"/i);
  return m ? m[1].toLowerCase() : null;
};

/**
 * Pesan teknis tanpa nilai data: buang isi "(...)" setelah Key/Failing row,
 * nilai dalam kutip tunggal, email, dan deret angka panjang (nomor HP dsb).
 */
export const sanitizeOrderErrorMessage = (raw?: string | null): string =>
  String(raw || '')
    .replace(/(failing row contains|key)\s*\([^)]*\)(=\([^)]*\))?/gi, '$1 (…)')
    .replace(/'[^']*'/g, "'…'")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{4,}\d/g, '[angka]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

export type OrderErrorReport = {
  stage: 'pickup_order_create';
  category: OrderErrorCategory;
  column: string | null;
  message: string;
  context: { isFuturePickup: boolean; kiloanLines: number; satuanLines: number };
};

export const buildOrderErrorReport = (
  raw: string | null | undefined,
  ctx: { isFuturePickup?: boolean; kiloanLines?: number; satuanLines?: number }
): OrderErrorReport => ({
  stage: 'pickup_order_create',
  category: classifyOrderError(raw),
  column: orderErrorColumnOf(raw),
  message: sanitizeOrderErrorMessage(raw),
  context: {
    isFuturePickup: Boolean(ctx.isFuturePickup),
    kiloanLines: Math.max(0, Math.min(50, Math.floor(Number(ctx.kiloanLines) || 0))),
    satuanLines: Math.max(0, Math.min(50, Math.floor(Number(ctx.satuanLines) || 0)))
  }
});

/** Validasi ulang di server — hanya field yang diizinkan, apa pun kiriman client. */
export const normalizeOrderErrorReport = (body: unknown): OrderErrorReport | null => {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.stage !== 'pickup_order_create') return null;
  const category = ORDER_ERROR_CATEGORIES.has(String(b.category)) ? (String(b.category) as OrderErrorCategory) : 'unknown';
  const col = typeof b.column === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(b.column) ? b.column : null;
  const ctx = (b.context && typeof b.context === 'object' ? b.context : {}) as Record<string, unknown>;
  const report = buildOrderErrorReport(typeof b.message === 'string' ? b.message : '', {
    isFuturePickup: ctx.isFuturePickup === true,
    kiloanLines: Number(ctx.kiloanLines),
    satuanLines: Number(ctx.satuanLines)
  });
  return { ...report, category, column: col };
};
