/** Tarif kiloan: hanya Kg × harga/Kg. Jumlah Pcs tidak masuk rumus. */

export const isKiloanItem = (item: any) => {
  const t = String(item?.type || item?.unit || '').toLowerCase();
  return t === 'kg' || t === 'kiloan';
};

export const kiloanWeightOf = (item: any) => {
  const fromWeight = Number(item?.weight ?? item?.kg);
  if (Number.isFinite(fromWeight) && fromWeight > 0) return fromWeight;
  if (isKiloanItem(item)) return Number(item?.qty) || 0;
  return 0;
};

export const kiloanLineTotal = (pricePerKg: number, kg: number) =>
  Math.round((Number(pricePerKg) || 0) * (Number(kg) || 0));

/** Subtotal baris keranjang. Pcs kiloan diabaikan; satuan tetap qty × harga. */
export const cartLineAmount = (item: any, durationMultiplier = 1) => {
  const unit = Math.round((Number(item?.basePrice ?? item?.price) || 0) * durationMultiplier);
  if (isKiloanItem(item)) return kiloanLineTotal(unit, kiloanWeightOf(item));
  return Math.round(unit * (Number(item?.qty) || 0));
};

/**
 * Total tampilan rincian item. Item kiloan tanpa `type` tetap dihitung dari Kg
 * (contoh Cuci Kering Lipat 3 Kg × Rp 5.000 = Rp 15.000, bukan harga satuan).
 */
export const displayItemAmount = (item: any) => {
  const unit = Number(item?.basePrice ?? item?.price) || 0;
  const explicit = Number(item?.line_total ?? item?.subtotal ?? item?.total);
  if (Number.isFinite(explicit) && explicit > unit && explicit > 0) return Math.round(explicit);
  const kg = Number(item?.weight ?? item?.kg) || 0;
  const typedPcs = String(item?.type || item?.unit || '').toLowerCase() === 'pcs';
  if (!typedPcs && kg > 0) return kiloanLineTotal(unit, kg);
  return cartLineAmount(item);
};
