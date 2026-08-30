'use client';

import { useEffect, useState } from 'react';
import { Clock, MapPin, Navigation, Store, X } from 'lucide-react';
import {
  dbGoogleStats,
  fetchOutletGoogleRating,
  googleRatingBadge,
  mapsDirectionsUrl,
  outletAddressOf,
  parseOutletImages,
  type ShowcaseOutlet
} from '@/lib/outletShowcase';

export default function OutletProfileDrawer({
  outlet,
  onClose
}: {
  outlet: ShowcaseOutlet | null;
  onClose: () => void;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [badge, setBadge] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');

  useEffect(() => {
    if (!outlet) return;
    setPhotoIdx(0);
    const saved = dbGoogleStats(outlet);
    setBadge(googleRatingBadge(saved.rating, saved.reviewCount));
    setMapsUrl(mapsDirectionsUrl(outlet));
    let cancelled = false;
    fetchOutletGoogleRating(outlet).then((live) => {
      if (cancelled) return;
      setBadge(googleRatingBadge(live.rating, live.reviewCount));
      if (live.mapsUrl) setMapsUrl(live.mapsUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [outlet]);

  if (!outlet) return null;

  const photos = parseOutletImages(outlet.images);
  const address = outletAddressOf(outlet);
  const hours = String(outlet.operating_hours || '').trim();

  return (
    <div className="fixed inset-0 z-[55] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-44 bg-slate-200">
          {photos.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photos[photoIdx % photos.length]}
              alt=""
              className="w-full h-full object-cover"
              onClick={() => photos.length > 1 && setPhotoIdx((i) => (i + 1) % photos.length)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-700 text-white">
              <Store className="w-10 h-10 opacity-80" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
          {photos.length > 1 && (
            <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
              {photos.map((src, i) => (
                <button
                  key={`${src.slice(0, 24)}-${i}`}
                  type="button"
                  onClick={() => setPhotoIdx(i)}
                  className={`h-1.5 rounded-full ${i === photoIdx % photos.length ? 'w-5 bg-white' : 'w-1.5 bg-white/50'}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <div>
            {outlet.is_coming_soon && (
              <span className="inline-block mb-1 bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                Coming Soon
              </span>
            )}
            <h2 className="text-base font-black text-slate-900">{String(outlet.name || 'Outlet')}</h2>
            {badge && <p className="text-xs font-bold text-amber-700 mt-1">{badge}</p>}
          </div>

          {hours && (
            <p className="text-xs text-slate-600 flex items-start gap-2">
              <Clock className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
              {hours}
            </p>
          )}
          {address && (
            <p className="text-xs text-slate-600 flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
              {address}
            </p>
          )}
          {outlet.is_coming_soon && outlet.opening_date_info && (
            <p className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {String(outlet.opening_date_info)}
            </p>
          )}

          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-3.5 rounded-2xl"
            >
              <Navigation className="w-4 h-4" />
              Petunjuk Arah (Google Maps)
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
