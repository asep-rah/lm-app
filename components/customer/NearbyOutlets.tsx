'use client';

import { MapPin, Navigation } from 'lucide-react';
import { distanceLabelKm, isComingSoonOutlet, outletAddressOf, type ShowcaseOutlet } from '@/lib/outletShowcase';

export default function NearbyOutlets({
  items,
  locating,
  onOpen,
  onRequestLocation
}: {
  items: Array<{ outlet: ShowcaseOutlet; km: number | null }>;
  locating?: boolean;
  onOpen: (outlet: ShowcaseOutlet) => void;
  onRequestLocation?: () => void;
}) {
  if (!items.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-800 tracking-wide uppercase flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-blue-600" />
          Outlet Terdekat
        </h3>
        {onRequestLocation && (
          <button type="button" onClick={onRequestLocation} className="text-[10px] font-bold text-blue-600">
            {locating ? 'Mencari GPS…' : 'Perbarui lokasi'}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {items.slice(0, 6).map(({ outlet, km }) => (
          <button
            key={String(outlet.id)}
            type="button"
            onClick={() => onOpen(outlet)}
            className="w-full bg-white border border-slate-200 rounded-2xl p-3 text-left shadow-sm hover:border-blue-400 transition flex items-start gap-3"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Navigation className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-slate-900 truncate">{String(outlet.name || 'Outlet')}</p>
              <p className="text-[10px] text-slate-500 truncate">{outletAddressOf(outlet) || 'Alamat belum diisi'}</p>
              {km != null ? (
                <p className="text-[10px] font-bold text-blue-600 mt-0.5">{distanceLabelKm(km)}</p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {isComingSoonOutlet(outlet) ? 'Segera dibuka' : 'Jarak belum tersedia'}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
