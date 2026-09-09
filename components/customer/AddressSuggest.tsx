'use client';

import type { AddressHit } from '@/lib/reverseGeocode';

export default function AddressSuggest({
  hits,
  onPick
}: {
  hits: AddressHit[];
  onPick: (hit: AddressHit) => void;
}) {
  if (!hits.length) return null;
  return (
    <div className="bg-white border border-indigo-100 rounded-xl overflow-hidden">
      <p className="text-[9px] font-black uppercase text-indigo-500 px-2.5 pt-1.5">Pilih yang paling mirip</p>
      {hits.map((hit, i) => (
        <button
          key={`${hit.lat}-${hit.lng}-${i}`}
          type="button"
          onClick={() => onPick(hit)}
          className="w-full text-left px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-indigo-50 border-t border-slate-50 first:border-t-0"
        >
          {hit.label}
        </button>
      ))}
    </div>
  );
}
