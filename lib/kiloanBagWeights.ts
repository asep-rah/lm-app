/**
 * Estimasi berat kiloan per kantong dari jumlah pakaian per kategori.
 *
 * Sumber tunggal untuk berat acuan (gram/pcs) — jangan duplikasi angka ini di
 * komponen UI lain (lihat AGENTS.md "Do not add new duplicated business-rule
 * arrays/calculations inside UI when a shared domain/configuration source
 * should exist"). Nilai di bawah adalah NILAI AWAL (default) yang wajar untuk
 * estimasi customer; kasir selalu menimbang ulang di outlet dan berhak
 * mengoreksi — lihat displayItemAmount/kiloanLineTotal di lib/kiloanPrice.ts
 * untuk bagaimana harga akhir tetap dihitung dari kg, bukan dari angka ini.
 */

export type BagCategoryKey = 'bajuRingan' | 'celanaBiasa' | 'celanaJeans' | 'cd' | 'bra';

export const BAG_CATEGORY_ORDER: BagCategoryKey[] = ['bajuRingan', 'celanaBiasa', 'celanaJeans', 'cd', 'bra'];

export const BAG_CATEGORY_LABELS: Record<BagCategoryKey, string> = {
  bajuRingan: 'Baju ringan (kaos/kemeja)',
  celanaBiasa: 'Celana biasa',
  celanaJeans: 'Celana jeans',
  cd: 'CD (celana dalam)',
  bra: 'Bra'
};

/** Berat acuan gram/pcs — nilai awal, dapat dikonfigurasi di satu tempat ini. */
export const DEFAULT_BAG_CATEGORY_WEIGHTS_G: Record<BagCategoryKey, number> = {
  bajuRingan: 200,
  celanaBiasa: 500,
  celanaJeans: 700,
  cd: 75,
  bra: 100
};

/** Minimal total kiloan per order (bukan per kantong) — mesin cuci 1 customer. */
export const KILOAN_MIN_ORDER_KG = 3;

/** Batas jumlah kantong yang bisa dipisah dalam satu form (kewajaran UI, bukan aturan bisnis). */
export const MAX_KILOAN_BAGS = 8;

export type BagCategoryCounts = Record<BagCategoryKey, string>;

export const emptyBagCategoryCounts = (): BagCategoryCounts => ({
  bajuRingan: '',
  celanaBiasa: '',
  celanaJeans: '',
  cd: '',
  bra: ''
});

/** Angka bulat ≥ 0 yang valid (string kosong TIDAK valid — wajib diisi, boleh "0"). */
const isValidCount = (raw: unknown): boolean => {
  const s = String(raw ?? '').trim();
  if (s === '') return false;
  if (!/^\d+$/.test(s)) return false;
  return Number.isFinite(Number(s));
};

/** Semua 5 isian sudah terisi angka valid (boleh 0) — syarat "wajib diisi". */
export const bagCategoryCountsComplete = (counts: BagCategoryCounts): boolean =>
  BAG_CATEGORY_ORDER.every((k) => isValidCount(counts[k]));

export type BagWeightSummary = { pcs: number; gram: number; kg: number };

/** Total pcs & estimasi kg dari isian per kategori × berat acuan. */
export const summarizeBagWeight = (
  counts: BagCategoryCounts,
  weights: Record<BagCategoryKey, number> = DEFAULT_BAG_CATEGORY_WEIGHTS_G
): BagWeightSummary => {
  let pcs = 0;
  let gram = 0;
  for (const k of BAG_CATEGORY_ORDER) {
    const n = isValidCount(counts[k]) ? Math.max(0, Math.round(Number(counts[k]))) : 0;
    pcs += n;
    gram += n * Math.max(0, Number(weights[k]) || 0);
  }
  return { pcs, gram, kg: Math.round((gram / 1000) * 100) / 100 };
};

/**
 * Syarat sebelum satu kantong/paket boleh ditambahkan ke keranjang: kelima
 * isian wajib terisi (boleh 0), TOTAL isian per kantong harus lebih dari 0.
 * Minimal 3kg TIDAK dicek di sini — itu aturan per ORDER, bukan per kantong
 * (lihat KILOAN_MIN_ORDER_KG dan kiloanOrderKgOf).
 */
export const bagCategoryCountsValid = (
  counts: BagCategoryCounts,
  weights: Record<BagCategoryKey, number> = DEFAULT_BAG_CATEGORY_WEIGHTS_G
): boolean => bagCategoryCountsComplete(counts) && summarizeBagWeight(counts, weights).gram > 0;

/** Total kg dari beberapa baris kiloan (satu order bisa punya beberapa kantong/paket). */
export const kiloanOrderKgOf = (lines: Array<{ kg?: number | string }>): number =>
  Math.round(lines.reduce((sum, l) => sum + (Number(l.kg) || 0), 0) * 100) / 100;
