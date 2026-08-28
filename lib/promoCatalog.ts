export type CatalogPromo = {
  id: string;
  title: string;
  desc: string;
  type: 'ongkir' | 'percent' | 'nominal';
  value: number;
  minTx: number;
  used_count: number;
  max_quota: number;
  is_active: boolean;
};

const asType = (raw: unknown): CatalogPromo['type'] => {
  const t = String(raw || '').toLowerCase();
  if (t.includes('ongkir') || t.includes('delivery')) return 'ongkir';
  if (t.includes('percent') || t === '%' || t.includes('pct')) return 'percent';
  return 'nominal';
};

/** Baris tabel `promos` Owner → bentuk yang dipakai dashboard pelanggan. */
export const mapDbPromo = (row: Record<string, unknown>): CatalogPromo => {
  const code = String(row.code || row.title || row.id || 'PROMO');
  const type = asType(row.discount_type || row.type);
  const value = Number(row.discount_value ?? row.value) || 0;
  return {
    id: String(row.id || code),
    title: code,
    desc: String(row.description || row.desc || `${type === 'percent' ? value + '%' : 'Rp ' + value.toLocaleString('id-ID')} off`),
    type,
    value,
    minTx: Number(row.min_transaction ?? row.minTx) || 0,
    used_count: Number(row.used_count) || 0,
    max_quota: Number(row.max_quota ?? row.maxQuota) || 0,
    is_active: row.is_active !== false
  };
};

export const mapSettingsPromo = (row: Record<string, unknown>, idx: number): CatalogPromo => ({
  id: String(row.id || `settings-${idx}`),
  title: String(row.title || row.code || 'Promo'),
  desc: String(row.desc || ''),
  type: asType(row.type),
  value: Number(row.value) || 0,
  minTx: Number(row.minTx) || 0,
  used_count: Number(row.used_count) || 0,
  max_quota: Number(row.max_quota) || 0,
  is_active: row.is_active !== false
});

export const promoIsClaimable = (promo: CatalogPromo, basket: number) => {
  if (!promo.is_active) return false;
  if (promo.max_quota > 0 && promo.used_count >= promo.max_quota) return false;
  if (basket < (Number(promo.minTx) || 0)) return false;
  return true;
};

/** Diskon selalu di-round ke rupiah penuh, tidak melebihi basis. */
export const promoDiscountRp = (promo: CatalogPromo | null | undefined, subtotal: number, ongkir: number) => {
  if (!promo) return 0;
  const sub = Math.max(0, Number(subtotal) || 0);
  const kirim = Math.max(0, Number(ongkir) || 0);
  let raw = 0;
  if (promo.type === 'ongkir') raw = Math.min(kirim, Number(promo.value) || 0);
  else if (promo.type === 'percent') raw = (sub * (Number(promo.value) || 0)) / 100;
  else raw = Number(promo.value) || 0;
  const cap = promo.type === 'ongkir' ? kirim : sub;
  return Math.max(0, Math.min(cap, Math.round(raw)));
};
