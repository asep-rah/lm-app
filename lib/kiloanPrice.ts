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
