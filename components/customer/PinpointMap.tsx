'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, MapPin, Minimize2, Navigation, X } from 'lucide-react';
import type { GeoPoint } from '@/lib/mapsNav';
import 'leaflet/dist/leaflet.css';

/** Last resort only; the form passes the phone's location or an outlet as fallbackCenter. */
const FALLBACK_CENTER: GeoPoint = { lat: -6.2, lng: 106.816666 };

type Props = {
  value?: GeoPoint | null;
  /** Where to open the map while no pin is set (phone location / nearest outlet). */
  fallbackCenter?: GeoPoint | null;
  onChange: (pt: GeoPoint) => void;
  onGps?: () => void;
  locating?: boolean;
};

export default function PinpointMap({ value, fallbackCenter, onChange, onGps, locating }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const skipMoveRef = useRef(false);
  const armedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  // Layar penuh saat menggeser pin: lebih mudah tepat di gerbang dari HP.
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    const setup = async () => {
      const leaflet = await import('leaflet');
      if (cancelled || !hostRef.current) return;
      const L = (leaflet as any).default || leaflet;

      const start = value || fallbackCenter || FALLBACK_CENTER;
      const map = L.map(host, {
        zoomControl: false,
        attributionControl: true,
        dragging: true
      }).setView([start.lat, start.lng], value ? 17 : fallbackCenter ? 15 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      // Zoom +/- on the right; the "Perbesar" button sits right under it (see render).
      L.control.zoom({ position: 'topright' }).addTo(map);

      map.on('dragend', () => {
        armedRef.current = true;
      });
      map.on('moveend', () => {
        if (skipMoveRef.current) {
          skipMoveRef.current = false;
          return;
        }
        if (!armedRef.current) return;
        const c = map.getCenter();
        onChangeRef.current({ lat: c.lat, lng: c.lng });
      });

      mapRef.current = map;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 200);
    };

    void setup();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value || !mapRef.current) return;
    const cur = mapRef.current.getCenter();
    if (Math.abs(cur.lat - value.lat) < 0.00004 && Math.abs(cur.lng - value.lng) < 0.00004) return;
    skipMoveRef.current = true;
    mapRef.current.setView([value.lat, value.lng], Math.max(mapRef.current.getZoom(), 17));
  }, [value?.lat, value?.lng]);

  // No pin yet: follow the fallback centre when it arrives later (GPS / outlets
  // load after the map), unless the customer already moved the map.
  useEffect(() => {
    if (value || !fallbackCenter || !mapRef.current || armedRef.current) return;
    skipMoveRef.current = true;
    mapRef.current.setView([fallbackCenter.lat, fallbackCenter.lng], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackCenter?.lat, fallbackCenter?.lng, ready]);

  useEffect(() => {
    const t = window.setTimeout(() => mapRef.current?.invalidateSize(), 60);
    if (!full) return () => window.clearTimeout(t);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

  const gpsButton = (
    <button
      type="button"
      onClick={onGps}
      disabled={locating}
      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-60"
    >
      <Navigation className="w-3 h-3" /> {locating ? 'GPS…' : 'GPS saya'}
    </button>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold text-slate-500 uppercase inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> Geser peta, pin tetap di tengah
        </p>
        {gpsButton}
      </div>
      {/* Same DOM node in both modes so Leaflet keeps its map; only the layout changes. */}
      <div
        className={full ? 'fixed inset-0 z-[115] bg-white flex flex-col' : 'relative'}
        role={full ? 'dialog' : undefined}
        aria-modal={full ? true : undefined}
        aria-label={full ? 'Peta titik jemput' : undefined}
      >
        {full && (
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100 pt-[max(0.625rem,env(safe-area-inset-top))]">
            <p className="text-[11px] font-extrabold text-slate-700">Geser peta sampai pin tepat di gerbang/pintu</p>
            <div className="flex items-center gap-1.5 shrink-0">
              {gpsButton}
              <button
                type="button"
                onClick={() => setFull(false)}
                className="text-[11px] font-black text-white bg-brand-600 px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Selesai
              </button>
            </div>
          </div>
        )}
        <div
          className={
            full ? 'relative flex-1' : 'relative h-64 w-full rounded-2xl overflow-hidden border border-slate-200'
          }
        >
          {/* Constant className: React must never overwrite the classes Leaflet adds (leaflet-container…);
              "relative" also stops Leaflet from pinning an inline position. Only the wrapper resizes. */}
          <div ref={hostRef} className="relative h-full w-full z-0 bg-slate-100" />
          {ready && (
            // Styled like Leaflet's zoom bar, placed right under it (top-right).
            <button
              type="button"
              onClick={() => setFull((v) => !v)}
              aria-label={full ? 'Kecilkan peta' : 'Perbesar'}
              title={full ? 'Kecilkan peta' : 'Perbesar peta'}
              className="absolute right-[10px] top-[84px] z-[1001] w-[34px] h-[34px] bg-white text-slate-800 rounded border-2 border-black/20 bg-clip-padding flex items-center justify-center hover:bg-slate-50"
            >
              {full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          {ready && (
            <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
              <div className="-translate-y-4 drop-shadow-md text-rose-600">
                <MapPin className="w-10 h-10" fill="currentColor" />
              </div>
            </div>
          )}
        </div>
      </div>
      {value ? (
        <p className="text-[10px] text-emerald-700 font-bold">
          Titik terpasang. Geser peta sampai pin tepat di gerbang/pintu.
        </p>
      ) : (
        <p className="text-[10px] text-amber-700 font-bold">
          Cari nama jalan, pilih saran, atau geser peta ke rumah Anda.
        </p>
      )}
    </div>
  );
}
