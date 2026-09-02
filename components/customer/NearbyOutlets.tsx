'use client';

import { ChevronDown, MapPin, Navigation } from 'lucide-react';
import {
  citiesMatch,
  dbGoogleStats,
  displayCityName,
  distanceLabelKm,
  googleRatingBadge,
  isComingSoonOutlet,
  outletAddressOf,
  type ShowcaseOutlet
} from '@/lib/outletShowcase';

export default function NearbyOutlets({
  items,
  locating,
  userCity,
  cities = [],
  showAllCities,
  onOpen,
  onRequestLocation,
  onSelectCity,
  onShowAllCities
}: {
  items: Array<{ outlet: ShowcaseOutlet; km: number | null }>;
  locating?: boolean;
  userCity?: string | null;
  cities?: string[];
  showAllCities?: boolean;
  onOpen: (outlet: ShowcaseOutlet) => void;
  onRequestLocation?: () => void;
  onSelectCity?: (city: string) => void;
  onShowAllCities?: () => void;
}) {
  const cityLabel = displayCityName(userCity) || 'Pilih kota';
  const emptyInCity = !showAllCities && Boolean(userCity) && items.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-800 tracking-wide uppercase flex items-center gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          Outlet Terdekat
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {onSelectCity && cities.length > 0 && (
            <label className="relative inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-700">
              <span className="text-slate-500">Kota:</span>
              <select
                value={
                  showAllCities
                    ? ''
                    : cities.find((c) => citiesMatch(c, userCity)) || userCity || ''
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) onShowAllCities?.();
                  else onSelectCity(v);
                }}
                className="appearance-none bg-slate-50 border border-slate-200 rounded-lg pl-1.5 pr-5 py-1 max-w-[8.5rem] truncate"
              >
                <option value="">Semua</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {displayCityName(c)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 pointer-events-none text-slate-400" />
            </label>
          )}
          {onRequestLocation && (
            <button type="button" onClick={onRequestLocation} className="text-[10px] font-bold text-blue-600 whitespace-nowrap">
              {locating ? 'Mencari GPS…' : 'Perbarui lokasi'}
            </button>
          )}
        </div>
      </div>

      {emptyInCity ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center space-y-2">
          <p className="text-xs font-bold text-slate-700">
            📍 Belum ada cabang resmi di {cityLabel}.
          </p>
          {onShowAllCities && (
            <button
              type="button"
              onClick={onShowAllCities}
              className="text-[11px] font-extrabold text-blue-600 underline"
            >
              Lihat Semua Kota
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 6).map(({ outlet, km }) => {
            const g = dbGoogleStats(outlet);
            return (
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
                  <p className="text-[10px] font-bold text-amber-700">
                    {googleRatingBadge(g.rating, g.reviewCount)}
                  </p>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
