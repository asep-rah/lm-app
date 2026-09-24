'use client';

import SatuanItemPhotoButton from '@/components/SatuanItemPhotoButton';
import { BAG_CATEGORY_LABELS, BAG_CATEGORY_ORDER } from '@/lib/kiloanBagWeights';
import { pickupItemsViewOf } from '@/lib/pickupItemsView';

/**
 * Rincian kantong kiloan & foto item satuan dari pesanan online — hanya
 * referensi untuk staf. Berat/harga adalah estimasi customer; kasir tetap
 * menimbang dan mengisi nota sendiri.
 */
export default function PickupItemsDetail({
  items,
  pickupOrderId,
  showCategories = true
}: {
  items: unknown;
  pickupOrderId?: string | null;
  /** Kasir perlu rincian per kategori untuk menimbang ulang; CS cukup ringkasan kantong. */
  showCategories?: boolean;
}) {
  const view = pickupItemsViewOf(items);
  if (!view.kiloan.length && !view.satuan.length) return null;
  const multiBag = view.kiloan.length > 1;
  return (
    <div className="space-y-2">
      {view.kiloan.map((bag, idx) => (
        <div key={`bag-${idx}`} className="bg-cyan-50 border border-cyan-200 rounded-lg p-2 text-[10px] text-cyan-900">
          <span className="font-extrabold block">
            🧺 {multiBag ? `Kantong ${idx + 1} — ` : ''}
            {bag.name}
            {bag.duration ? ` (${bag.duration})` : ''}
          </span>
          <span className="block font-semibold">
            {bag.pcs !== null ? `${bag.pcs} pcs · ` : ''}estimasi ±{bag.estKg} kg
          </span>
          {showCategories && bag.counts && (
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
              {BAG_CATEGORY_ORDER.map((key) => (
                <span key={key}>
                  {BAG_CATEGORY_LABELS[key]}: <b>{bag.counts?.[key] ?? 0}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {view.satuan.map((it, idx) => (
        <div key={`sat-${idx}`} className="bg-violet-50 border border-violet-200 rounded-lg p-2 text-[10px] text-violet-900">
          <span className="font-extrabold block mb-1">
            👔 {it.name} × {it.qty}
            {it.duration ? ` (${it.duration})` : ''}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {it.photoPaths.map((path, pIdx) =>
              path ? (
                <SatuanItemPhotoButton
                  key={pIdx}
                  pickupOrderId={pickupOrderId}
                  path={path}
                  label={it.photoPaths.length > 1 ? `Foto pcs ${pIdx + 1}` : 'Lihat Foto'}
                />
              ) : (
                <span key={pIdx} className="text-[9px] font-bold text-slate-500">
                  Pcs {pIdx + 1}: tanpa foto
                </span>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
