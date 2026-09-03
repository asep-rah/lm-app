'use client';

import { useEffect, useRef } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import type { GeoPoint } from '@/lib/mapsNav';

const DEFAULT_CENTER: GeoPoint = { lat: -6.966667, lng: 110.416664 };

type Props = {
  value?: GeoPoint | null;
  onChange: (pt: GeoPoint) => void;
  onGps?: () => void;
};

export default function PinpointMap({ value, onChange, onGps }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    const setup = async () => {
      const leaflet = await import('leaflet');
      if (cancelled || !hostRef.current) return;
      const L = (leaflet as any).default || leaflet;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
      });

      const start = value || DEFAULT_CENTER;
      const map = L.map(host, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], value ? 17 : 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      const marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onChangeRef.current({ lat: pos.lat, lng: pos.lng });
      });
      map.on('click', (e: any) => {
        marker.setLatLng(e.latlng);
        onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      });

      mapRef.current = map;
      markerRef.current = marker;
      setTimeout(() => map.invalidateSize(), 200);
    };

    void setup();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // mount once; later coord updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value || !mapRef.current || !markerRef.current) return;
    const cur = markerRef.current.getLatLng();
    if (Math.abs(cur.lat - value.lat) < 0.00001 && Math.abs(cur.lng - value.lng) < 0.00001) return;
    markerRef.current.setLatLng([value.lat, value.lng]);
    mapRef.current.setView([value.lat, value.lng], Math.max(mapRef.current.getZoom(), 17));
  }, [value?.lat, value?.lng]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold text-slate-500 uppercase inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> Pin gerbang / rumah
        </p>
        <button
          type="button"
          onClick={onGps}
          className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg inline-flex items-center gap-1"
        >
          <Navigation className="w-3 h-3" /> GPS saya
        </button>
      </div>
      <div ref={hostRef} className="h-48 w-full rounded-2xl overflow-hidden border border-slate-200 z-0" />
      <p className="text-[9px] text-slate-400 font-medium">
        Geser pin atau ketuk peta ke gerbang. GPS mengisi alamat; ketik alamat juga memindahkan pin.
      </p>
      {value && (
        <p className="text-[9px] text-emerald-600 font-bold">
          Pin: {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
        </p>
      )}
    </div>
  );
}
