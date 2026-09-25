import { supabase } from '@/lib/supabaseClient';
import { updateWithFallback } from '@/lib/safeWrite';
import type { PnlMonthRef } from '@/lib/pnlReport';

export const FA_GROUPS = [
  { key: 'machine', label: 'Outlet - Machine', short: 'Machine', life: 60, aliases: ['machine', 'mesin', 'washer', 'dryer'] },
  { key: 'furniture', label: 'Outlet - Furniture', short: 'Furniture', life: 60, aliases: ['furniture', 'interior'] },
  { key: 'promo', label: 'Outlet - Promotion Tools', short: 'Promotion Tools', life: 36, aliases: ['promotion', 'promo'] },
  { key: 'tools', label: 'Outlet - Tools & Equipment', short: 'Tools & Equipment', life: 48, aliases: ['tools', 'equipment', 'setrika', 'kendaraan', 'lainnya'] },
  { key: 'it', label: 'Outlet - IT Solution', short: 'IT Solution', life: 24, aliases: ['it', 'kasir', 'solution'] },
  { key: 'renovation', label: 'Outlet - Renovation', short: 'Renovation', life: 60, aliases: ['renovasi', 'renovation'] }
] as const;

export const ASSET_CATEGORIES = FA_GROUPS.map((g) => g.label);

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export function mapAssetGroup(category: string) {
  const cat = String(category || '').toLowerCase();
  return FA_GROUPS.find((g) => g.label.toLowerCase() === cat || g.aliases.some((a) => cat.includes(a))) || FA_GROUPS[3];
}

export function defaultLifeOf(category: string) {
  return mapAssetGroup(category).life;
}

export type FixedAsset = {
  id: string;
  name: string;
  category: string;
  cost: number;
  residual: number;
  acquiredAt: string;
  lifeMonths: number;
};

export type CapitalMove = {
  id: string;
  date: string;
  amount: number;
  note: string;
};

export type OutletBook = {
  outletId: string;
  booksStart: string;
  openingCapital: number;
  openingCash: number;
  openingLiabilities: number;
  receivables: number;
  otherCurrentAssets: number;
  tradePayables: number;
  longTermPayables: number;
  leasePayables: number;
  assets: FixedAsset[];
  extraCapital: CapitalMove[];
  drawings: CapitalMove[];
};

const LS_KEY = 'laundry_outlet_books';

const todayIso = () => new Date().toISOString().slice(0, 10);

const nid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const emptyAsset = (): FixedAsset => ({
  id: nid(),
  name: '',
  category: FA_GROUPS[0].label,
  cost: 0,
  residual: 0,
  acquiredAt: todayIso(),
  lifeMonths: FA_GROUPS[0].life
});

export const emptyBook = (outletId = ''): OutletBook => ({
  outletId,
  booksStart: todayIso(),
  openingCapital: 0,
  openingCash: 0,
  openingLiabilities: 0,
  receivables: 0,
  otherCurrentAssets: 0,
  tradePayables: 0,
  longTermPayables: 0,
  leasePayables: 0,
  assets: [emptyAsset()],
  extraCapital: [],
  drawings: []
});

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const asMoves = (raw: unknown): CapitalMove[] =>
  (Array.isArray(raw) ? raw : []).map((m: any) => ({
    id: String(m?.id || nid()),
    date: String(m?.date || todayIso()),
    amount: num(m?.amount),
    note: String(m?.note || '')
  }));

export function normalizeBook(raw: any, fallbackId = ''): OutletBook {
  const assets = (Array.isArray(raw?.assets) ? raw.assets : []).map((a: any) => {
    const category = mapAssetGroup(a?.category || '').label;
    return {
      id: String(a?.id || nid()),
      name: String(a?.name || ''),
      category,
      cost: num(a?.cost),
      residual: Math.max(0, num(a?.residual)),
      acquiredAt: String(a?.acquiredAt || a?.acquired_at || todayIso()),
      lifeMonths: Math.max(1, Math.round(num(a?.lifeMonths ?? a?.life_months) || defaultLifeOf(category)))
    };
  });
  const longTerm = num(raw?.longTermPayables ?? raw?.long_term_payables);
  return {
    outletId: String(raw?.outletId || raw?.outlet_id || fallbackId),
    booksStart: String(raw?.booksStart || raw?.books_start || todayIso()),
    openingCapital: num(raw?.openingCapital ?? raw?.opening_capital),
    openingCash: num(raw?.openingCash ?? raw?.opening_cash),
    openingLiabilities: num(raw?.openingLiabilities ?? raw?.opening_liabilities),
    receivables: num(raw?.receivables ?? raw?.piutang),
    otherCurrentAssets: num(raw?.otherCurrentAssets ?? raw?.other_current_assets),
    tradePayables: num(raw?.tradePayables ?? raw?.trade_payables),
    longTermPayables: longTerm || num(raw?.openingLiabilities ?? raw?.opening_liabilities),
    leasePayables: num(raw?.leasePayables ?? raw?.lease_payables),
    assets: assets.length ? assets : [emptyAsset()],
    extraCapital: asMoves(raw?.extraCapital ?? raw?.extra_capital),
    drawings: asMoves(raw?.drawings)
  };
}

const parseStore = (raw: unknown): Record<string, OutletBook> => {
  if (!raw) return {};
  const obj = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, OutletBook> = {};
  Object.entries(obj as Record<string, unknown>).forEach(([id, v]) => {
    if (id.startsWith('__') || !v || typeof v !== 'object') return;
    out[id] = normalizeBook(v, id);
  });
  return out;
};

export const booksOf = (store: Record<string, OutletBook>, outletId: string): OutletBook[] =>
  outletId === 'ALL' ? Object.values(store) : store[outletId] ? [store[outletId]] : [];

export const assetCostOf = (book: OutletBook) =>
  (book.assets || []).reduce((s, a) => s + num(a.cost), 0);

export function recordedPayables(book: OutletBook) {
  return num(book.tradePayables) + num(book.longTermPayables) + num(book.leasePayables);
}

/**
 * Akumulasi penyusutan aset yang sudah terjadi SEBELUM tanggal mulai
 * pembukuan (aset dibeli sebelum outlet mulai dibukukan di aplikasi). Masuk
 * neraca pembukaan sebagai Akumulasi Penyusutan, jadi aset tercatat di nilai
 * buku pada tanggal mulai — bukan di harga perolehan penuh.
 */
export function openingAccumDep(book: OutletBook) {
  if (!book.booksStart) return 0;
  const d = new Date(book.booksStart);
  if (Number.isNaN(d.getTime())) return 0;
  const before: PnlMonthRef = d.getMonth() === 0 ? { year: d.getFullYear() - 1, month: 11 } : { year: d.getFullYear(), month: d.getMonth() - 1 };
  return accumDepreciation(book, before);
}

/** Nilai buku aset tetap pada tanggal mulai pembukuan. */
export const openingAssetNetOf = (book: OutletBook) => assetCostOf(book) - openingAccumDep(book);

/** Kas pembukaan: isi manual, atau sisa modal + hutang setelah aset (nilai buku) & piutang. */
export function resolvedOpeningCash(book: OutletBook) {
  if (num(book.openingCash) > 0) return num(book.openingCash);
  return Math.max(
    0,
    num(book.openingCapital) + recordedPayables(book) - openingAssetNetOf(book) - num(book.receivables) - num(book.otherCurrentAssets)
  );
}

export function openingGap(book: OutletBook) {
  return (
    resolvedOpeningCash(book) +
    num(book.receivables) +
    num(book.otherCurrentAssets) +
    openingAssetNetOf(book) -
    num(book.openingCapital) -
    recordedPayables(book)
  );
}

const monthIndex = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getFullYear() * 12 + d.getMonth();
};

/** Bulan perolehan sampai bulan as-of, inklusif. 0 jika aset belum ada. */
export function monthsOwned(acquiredAt: string, ref: PnlMonthRef) {
  const start = monthIndex(acquiredAt);
  const end = ref.year * 12 + ref.month;
  return Math.max(0, end - start + 1);
}

export function assetSchedule(asset: FixedAsset, ref: PnlMonthRef) {
  const cost = num(asset.cost);
  const residual = Math.min(cost, Math.max(0, num(asset.residual)));
  const depreciable = Math.max(0, cost - residual);
  const life = Math.max(1, Math.round(num(asset.lifeMonths) || 60));
  const monthly = depreciable / life;
  const owned = monthsOwned(asset.acquiredAt, ref);
  const charged = Math.min(life, owned);
  const accum = Math.min(depreciable, monthly * charged);
  const inService = owned > 0 && charged <= life && owned <= life;
  const monthCharge = owned > 0 && owned <= life ? monthly : 0;
  return {
    cost,
    residual,
    depreciable,
    life,
    monthly,
    owned,
    charged,
    accum,
    bookValue: cost - accum,
    monthCharge: inService || owned === life ? monthCharge : 0
  };
}

export function monthDepreciation(book: OutletBook, ref: PnlMonthRef) {
  return (book.assets || [])
    .filter((a) => num(a.cost) > 0)
    .reduce((s, a) => s + assetSchedule(a, ref).monthCharge, 0);
}

export function accumDepreciation(book: OutletBook, ref: PnlMonthRef) {
  return (book.assets || [])
    .filter((a) => num(a.cost) > 0)
    .reduce((s, a) => s + assetSchedule(a, ref).accum, 0);
}

export function depreciationInMonth(store: Record<string, OutletBook>, outletId: string, ref: PnlMonthRef) {
  return booksOf(store, outletId).reduce((s, b) => s + monthDepreciation(b, ref), 0);
}

export async function loadOutletBooks(): Promise<Record<string, OutletBook>> {
  const { data } = await supabase
    .from('app_settings')
    .select('outlet_books, outlet_overrides')
    .eq('id', 1)
    .maybeSingle();

  const fromCol = parseStore(data?.outlet_books);
  if (Object.keys(fromCol).length) return fromCol;

  let nested: unknown = null;
  try {
    const ov = typeof data?.outlet_overrides === 'string'
      ? JSON.parse(data.outlet_overrides || '{}')
      : data?.outlet_overrides;
    nested = ov?.__outlet_books;
  } catch {
    nested = null;
  }
  const fromNested = parseStore(nested);
  if (Object.keys(fromNested).length) return fromNested;

  try {
    return parseStore(localStorage.getItem(LS_KEY));
  } catch {
    return {};
  }
}

export async function saveOutletBook(book: OutletBook): Promise<{ error: string | null }> {
  const clean = normalizeBook(book, book.outletId);
  if (!clean.outletId) return { error: 'Outlet pembukuan belum diketahui.' };
  clean.openingCash = resolvedOpeningCash(clean);
  clean.assets = (clean.assets || []).filter((a) => String(a.name || '').trim() || num(a.cost) > 0);
  if (!clean.assets.length) clean.assets = [emptyAsset()];

  const current = await loadOutletBooks();
  current[clean.outletId] = clean;

  try {
    localStorage.setItem(LS_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }

  const { data: settings } = await supabase
    .from('app_settings')
    .select('outlet_overrides')
    .eq('id', 1)
    .maybeSingle();

  let overrides: any = {};
  try {
    overrides = typeof settings?.outlet_overrides === 'string'
      ? JSON.parse(settings.outlet_overrides || '{}')
      : (settings?.outlet_overrides || {});
  } catch {
    overrides = {};
  }
  if (!overrides || typeof overrides !== 'object') overrides = {};
  overrides.__outlet_books = current;

  const { error } = await updateWithFallback(
    'app_settings',
    [
      { outlet_books: current, outlet_overrides: overrides },
      { outlet_books: current },
      { outlet_overrides: overrides },
      { outlet_overrides: JSON.stringify(overrides) }
    ],
    { column: 'id', value: 1 }
  );
  return { error: error?.message || null };
}

export async function findOutletIdByName(name: string): Promise<string | null> {
  const { data } = await supabase.from('outlets').select('id, name').eq('name', name);
  const row = (data || []).slice(-1)[0];
  return row?.id ? String(row.id) : null;
}

export const idr = (n: number) =>
  `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
