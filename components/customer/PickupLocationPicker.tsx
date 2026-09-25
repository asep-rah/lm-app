'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import PinpointMap from '@/components/customer/PinpointMap';
import AddressSuggest from '@/components/customer/AddressSuggest';
import type { GeoPoint } from '@/lib/mapsNav';
import { reverseGeocodeAddress, searchAddressSuggestions, type AddressHit } from '@/lib/reverseGeocode';
import { composePickupAddress, isValidHouseNumber, splitHouseNumber } from '@/lib/pickupAddress';
import { SEARCH_DRIFT_WARN_M, distanceM, formatMeters, gpsAccuracyLevel } from '@/lib/serviceArea';

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
  /** Map centre while no pin is set (phone location / nearest outlet). */
  fallbackCenter?: GeoPoint | null;
  /** Accuracy (m) of the GPS fix currently used as the pin; null when the pin came from the map. */
  gpsAccuracyM?: number | null;
  /** Confirmation card ("Ya, titik sudah tepat") — shown only when onConfirm is given. */
  confirmed?: boolean;
  onConfirm?: () => void;
  outletName?: string;
  /** Straight-line km from the pin to the chosen outlet. */
  outletKm?: number | null;
};

const keyOf = (pt: GeoPoint | null | undefined) => (pt ? `${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}` : '');

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
  onGps,
  fallbackCenter,
  gpsAccuracyM,
  confirmed,
  onConfirm,
  outletName,
  outletKm
}: Props) {
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'miss'>('idle');
  const searchTimer = useRef<number | null>(null);
  // Hasil pencarian yang dipilih + pin terakhir yang dipasang dari komponen ini.
  // Peringatan "pin jauh dari alamat yang dicari" hanya berlaku selama pin masih
  // berasal dari sini (bukan alamat tersimpan / GPS).
  const [anchor, setAnchor] = useState<(GeoPoint & { label: string }) | null>(null);
  const [ownPinKey, setOwnPinKey] = useState('');

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
    const pt = { lat: hit.lat, lng: hit.lng };
    setAnchor({ ...pt, label: streetLabel || hit.label });
    setOwnPinKey(keyOf(pt));
    onPin(pt, streetLabel);
  };

  const movePin = async (pt: GeoPoint) => {
    setOwnPinKey(keyOf(pt));
    onPin(pt);
    const label = await reverseGeocodeAddress(pt.lat, pt.lng);
    if (label) applyStreetLabel(label);
  };

  const accuracy = gpsAccuracyLevel(gpsAccuracyM);
  const pinKey = keyOf(pin);
  const drift = anchor && pin && pinKey === ownPinKey ? distanceM({ lat: anchor.lat, lon: anchor.lng }, { lat: pin.lat, lon: pin.lng }) : 0;
  const driftM = drift > SEARCH_DRIFT_WARN_M ? drift : null;
  const summary = street.trim() ? composePickupAddress(street, houseNo, landmark) : '';

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
        fallbackCenter={fallbackCenter}
        locating={locating}
        onGps={
          onGps
            ? () => {
                setAnchor(null);
                onGps();
              }
            : undefined
        }
        onChange={movePin}
      />
      {hint ? <p className="text-[10px] font-bold text-indigo-700">{hint}</p> : null}
      {pin && accuracy !== 'unknown' ? (
        accuracy === 'good' ? (
          <p className="text-[10px] font-bold text-emerald-700">GPS akurat ({formatMeters(Number(gpsAccuracyM))}).</p>
        ) : (
          <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex gap-1.5" role="alert">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              Lokasi GPS kurang akurat ({formatMeters(Number(gpsAccuracyM))}). Tekan &quot;Perbesar&quot;, lalu geser peta sampai pin tepat di
              gerbang rumah Anda.
            </span>
          </p>
        )
      ) : null}
      {driftM != null ? (
        <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex gap-1.5" role="alert">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            Pin berjarak {formatMeters(driftM)} dari &quot;{anchor?.label}&quot; yang Anda pilih. Pastikan pin ada di rumah Anda, bukan di
            tempat lain.
          </span>
        </p>
      ) : null}
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
      {onConfirm && pin ? (
        confirmed ? (
          <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>Titik jemput sudah dipastikan. Bila peta digeser lagi, Anda akan diminta memastikan ulang.</span>
          </p>
        ) : (
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-indigo-800">Pastikan titik jemput</p>
            <p className="text-[11px] font-bold text-slate-800">{summary || 'Isi nama jalan dan nomor rumah di atas.'}</p>
            {outletName ? (
              <p className="text-[10px] text-slate-600">
                Outlet: <b>{outletName}</b>
                {outletKm != null ? ` · ±${outletKm.toFixed(1).replace('.', ',')} km (garis lurus)` : ''}
              </p>
            ) : null}
            <p className="text-[10px] text-slate-500">Driver akan datang ke titik pin merah di peta. Sudah tepat di gerbang/pintu rumah Anda?</p>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!street.trim() || !isValidHouseNumber(houseNo)}
              className="w-full bg-brand-600 text-white text-xs font-black rounded-xl py-2.5 disabled:opacity-50"
            >
              Ya, titik sudah tepat
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
