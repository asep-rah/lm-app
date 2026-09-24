/**
 * Ringkasan pickup_orders.items untuk tampilan staf (POS & CS). Pure — hanya
 * membaca data yang disimpan form customer; tidak mengubah keranjang/nota.
 */
import {
  BAG_CATEGORY_ORDER,
  summarizeBagWeight,
  type BagCategoryCounts,
  type BagCategoryKey
} from '@/lib/kiloanBagWeights';

export type PickupKiloanView = {
  name: string;
  duration: string;
  estKg: number;
  pcs: number | null;
  counts: Record<BagCategoryKey, number> | null;
};

export type PickupSatuanView = {
  name: string;
  qty: number;
  duration: string;
  photoPaths: Array<string | null>;
};

export type PickupItemsView = { kiloan: PickupKiloanView[]; satuan: PickupSatuanView[] };

type RawItem = {
  name?: unknown;
  qty?: unknown;
  weight?: unknown;
  duration?: unknown;
  type?: unknown;
  bag_category_counts?: unknown;
  pieces?: unknown;
};

const toCounts = (raw: unknown): Record<BagCategoryKey, number> | null => {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = {} as Record<BagCategoryKey, number>;
  for (const k of BAG_CATEGORY_ORDER) out[k] = Math.max(0, Math.floor(Number(src[k]) || 0));
  return out;
};

export const pickupItemsViewOf = (items: unknown): PickupItemsView => {
  let list: unknown = items;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  const view: PickupItemsView = { kiloan: [], satuan: [] };
  if (!Array.isArray(list)) return view;
  for (const raw of list as RawItem[]) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '-');
    const duration = String(raw.duration || '');
    if (raw.type === 'kg' || raw.bag_category_counts) {
      const counts = toCounts(raw.bag_category_counts);
      const summary = counts
        ? summarizeBagWeight(
            Object.fromEntries(BAG_CATEGORY_ORDER.map((k) => [k, String(counts[k])])) as BagCategoryCounts
          )
        : null;
      view.kiloan.push({
        name,
        duration,
        estKg: Number(raw.weight) > 0 ? Number(raw.weight) : summary?.kg || 0,
        pcs: summary ? summary.pcs : null,
        counts
      });
    } else if (Array.isArray(raw.pieces) && raw.pieces.length > 0) {
      view.satuan.push({
        name,
        qty: Number(raw.qty) || raw.pieces.length,
        duration,
        photoPaths: raw.pieces.map((p) => {
          const path = (p as { photo_path?: unknown })?.photo_path;
          return typeof path === 'string' && path ? path : null;
        })
      });
    }
  }
  return view;
};
