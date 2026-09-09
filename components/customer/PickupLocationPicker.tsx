'use client';

import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import PinpointMap from '@/components/customer/PinpointMap';
import AddressSuggest from '@/components/customer/AddressSuggest';
import type { GeoPoint } from '@/lib/mapsNav';
import { reverseGeocodeAddress, searchAddressSuggestions, type AddressHit } from '@/lib/reverseGeocode';
import { splitHouseNumber } from '@/lib/pickupAddress';

type Props = {
  street: string;
  houseNo: string;
  landmark?: string;
  pin: GeoPoint | null;
  locating?: boolean;
  hint?: string;
  onStreetChange: (v: string) => void;
  onHouseNoChange: (v: string) => void;
  onLandmarkChange?: (v: string) => void;
  onPin: (pt: GeoPoint, streetLabel?: string) => void;
  onGps?: () => void;
};

export default function PickupLocationPicker({
  street,
  houseNo,
  landmark,
  pin,
  locating,
  hint,
  onStreetChange,
  onHouseNoChange,
  onLandmarkChange,
  onPin,
  onGps
}: Props) {
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'miss'>('idle');
  const searchTimer = useRef<number | null>(null);

  const searchStreet = (q: string) => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const query = q.trim();
    if (query.length < 6) {
      setHits([]);
      setStatus('idle');
      return;
    }
    setStatus('searching');
    searchTimer.current = window.setTimeout(() => {
      void searchAddressSuggestions(query).then((rows) => {
        setHits(rows);
        setStatus(rows.length ? 'found' : 'miss');
      });
    }, 450);
  };

  const applyStreetLabel = (label: string) => {
    const parts = splitHouseNumber(label);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    setHits([]);
    setStatus('found');
    onStreetChange(parts.street);
    if (!houseNo.trim() && parts.house) onHouseNoChange(parts.house);
    return parts.street;
  };

  const pick = (hit: AddressHit) => {
    const streetLabel = applyStreetLabel(hit.label);
    onPin({ lat: hit.lat, lng: hit.lng }, streetLabel);
  };

  const movePin = async (pt: GeoPoint) => {
    onPin(pt);
    const label = await reverseGeocodeAddress(pt.lat, pt.lng);
    if (label) applyStreetLabel(label);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
        <input
          value={street}
          onChange={(e) => {
            onStreetChange(e.target.value);
            searchStreet(e.target.value);
          }}
          placeholder="Cari nama jalan / komplek / patokan besar"
          className="w-full bg-slate-50 border border-slate-300 rounded-2xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-800"
        />
      </div>
      {status === 'searching' && <p className="text-[9px] text-indigo-600 font-bold">Mencari lokasi…</p>}
      {status === 'miss' && (
        <p className="text-[9px] text-amber-700 font-bold">Tidak ketemu. Geser peta ke rumah, atau perjelas nama jalan.</p>
      )}
      <AddressSuggest hits={hits} onPick={pick} />
      <PinpointMap
        value={pin}
        locating={locating}
        onGps={onGps}
        onChange={movePin}
      />
      {hint ? <p className="text-[10px] font-bold text-indigo-700">{hint}</p> : null}
      <div>
        <label className="text-[10px] font-extrabold text-slate-500 uppercase">No. rumah / blok *</label>
        <input
          value={houseNo}
          onChange={(e) => onHouseNoChange(e.target.value)}
          placeholder="Wajib. Contoh: 117, 12A, B-3, atau rumah no.117"
          className="mt-1 w-full bg-white border-2 border-amber-300 rounded-xl px-3 py-2.5 text-sm font-black text-slate-900"
        />
        <p className="text-[9px] text-slate-400 mt-0.5">Wajib ada nomor rumah/blok. Pin tidak ikut berubah.</p>
      </div>
      {onLandmarkChange ? (
        <input
          value={landmark || ''}
          onChange={(e) => onLandmarkChange(e.target.value)}
          placeholder="Patokan (opsional): pagar hijau, samping Alfamart"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-semibold text-slate-700"
        />
      ) : null}
    </div>
  );
}
