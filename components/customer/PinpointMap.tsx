'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import type { GeoPoint } from '@/lib/mapsNav';
import 'leaflet/dist/leaflet.css';

const FALLBACK_CENTER: GeoPoint = { lat: -6.2, lng: 106.816666 };

type Props = {
  value?: GeoPoint | null;
  onChange: (pt: GeoPoint) => void;
  onGps?: () => void;
  locating?: boolean;
};

export default function PinpointMap({ value, onChange, onGps, locating }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const skipMoveRef = useRef(false);
  const armedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    const setup = async () => {
      const leaflet = await import('leaflet');
      if (cancelled || !hostRef.current) return;
      const L = (leaflet as any).default || leaflet;

      const start = value || FALLBACK_CENTER;
      const map = L.map(host, {
        zoomControl: true,
        attributionControl: true,
        dragging: true
      }).setView([start.lat, start.lng], value ? 17 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

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

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold text-slate-500 uppercase inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> Geser peta, pin tetap di tengah
        </p>
        <button
          type="button"
          onClick={onGps}
          disabled={locating}
          className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-60"
        >
          <Navigation className="w-3 h-3" /> {locating ? 'GPS…' : 'GPS saya'}
        </button>
      </div>
      <div className="relative">
        <div ref={hostRef} className="h-56 w-full rounded-2xl overflow-hidden border border-slate-200 z-0 bg-slate-100" />
        {ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="-translate-y-4 drop-shadow-md text-rose-600">
              <MapPin className="w-10 h-10" fill="currentColor" />
            </div>
          </div>
        )}
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
