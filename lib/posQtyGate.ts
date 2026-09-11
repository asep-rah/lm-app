/** Gate qty kasir: kiloan wajib Kg + Pcs; satuan cukup Pcs. */

export type QtyGateItem = {
  type?: string | null;
  qty?: number | string | null;
  weight?: number | string | null;
  pcs?: number | string | null;
  name?: string | null;
};

export type QtyGateInput = {
  weight_kg?: number | string | null;
  pcs_count?: number | string | null;
  items?: QtyGateItem[] | null;
  cartItems?: QtyGateItem[] | null;
  /** true jika layanan katalog bertipe pcs / satuan */
  isSatuanService?: boolean;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export const isSatuanItem = (item: QtyGateItem) => {
  const t = String(item?.type || '').toLowerCase();
  return t === 'pcs' || t === 'satuan';
};

export const assertPosQtyReady = (input: QtyGateInput): { ok: true } | { ok: false; message: string } => {
  const items = (Array.isArray(input.items) && input.items.length
    ? input.items
    : Array.isArray(input.cartItems) && input.cartItems.length
      ? input.cartItems
      : []) as QtyGateItem[];

  if (items.length > 0) {
    for (const it of items) {
      if (isSatuanItem(it)) {
        const pcs = n(it.pcs) || n(it.qty);
        if (pcs <= 0) {
          return {
            ok: false,
            message: `Order satuan wajib isi jumlah Pcs (${it.name || 'item'}).`
          };
        }
      } else {
        const kg = n(it.weight) || n(it.qty);
        const pcs = n(it.pcs);
        if (kg <= 0) {
          return {
            ok: false,
            message: `Order kiloan wajib isi jumlah Kg (${it.name || 'item'}).`
          };
        }
        if (pcs <= 0) {
          return {
            ok: false,
            message: `Order kiloan wajib isi jumlah Pcs juga (${it.name || 'item'}).`
          };
        }
      }
    }
    return { ok: true };
  }

  const kg = n(input.weight_kg);
  const pcs = n(input.pcs_count);

  if (input.isSatuanService === true) {
    if (pcs <= 0) {
      return { ok: false, message: 'Order satuan wajib isi jumlah Pcs sebelum cetak struk.' };
    }
    return { ok: true };
  }

  if (kg <= 0 || pcs <= 0) {
    return {
      ok: false,
      message: 'Wajib isi jumlah Kg dan jumlah Pcs sebelum cetak struk (kecuali order satuan: cukup Pcs).'
    };
  }
  return { ok: true };
};
