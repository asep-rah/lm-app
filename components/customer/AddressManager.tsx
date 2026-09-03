'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import PinpointMap from '@/components/customer/PinpointMap';
import {
  ADDRESS_LABEL_PRESETS,
  type SavedAddress
} from '@/lib/customerAddresses';
import type { GeoPoint } from '@/lib/mapsNav';
import { geocodeAddress, reverseGeocodeAddress } from '@/lib/reverseGeocode';

export default function AddressManager({
  addresses,
  busy,
  onSave,
  onDelete,
  onSetPrimary
}: {
  addresses: SavedAddress[];
  busy?: boolean;
  onSave: (draft: {
    id?: string;
    label: string;
    full_address: string;
    is_primary?: boolean;
    latitude?: number | null;
    longitude?: number | null;
  }) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onSetPrimary: (id: string) => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | 'NEW' | null>(null);
  const [label, setLabel] = useState('Rumah');
  const [fullAddress, setFullAddress] = useState('');
  const [asPrimary, setAsPrimary] = useState(false);
  const [pin, setPin] = useState<GeoPoint | null>(null);

  const startNew = () => {
    setEditingId('NEW');
    setLabel('Rumah');
    setFullAddress('');
    setAsPrimary(addresses.length === 0);
    setPin(null);
  };

  const startEdit = (row: SavedAddress) => {
    setEditingId(row.id);
    setLabel(row.label);
    setFullAddress(row.full_address);
    setAsPrimary(row.is_primary);
    setPin(
      row.latitude != null && row.longitude != null && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
        ? { lat: Number(row.latitude), lng: Number(row.longitude) }
        : null
    );
  };

  const cancel = () => {
    setEditingId(null);
    setFullAddress('');
    setPin(null);
  };

  const submit = async () => {
    if (fullAddress.trim().length < 5) return alert('Isi alamat lengkap (minimal 5 karakter).');
    await onSave({
      id: editingId === 'NEW' ? undefined : editingId || undefined,
      label,
      full_address: fullAddress.trim(),
      is_primary: asPrimary || addresses.length === 0,
      latitude: pin?.lat ?? null,
      longitude: pin?.lng ?? null
    });
    cancel();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400 uppercase font-extrabold">Alamat Tersimpan</span>
        {editingId !== 'NEW' && (
          <button
            type="button"
            onClick={startNew}
            className="text-[10px] font-extrabold text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Tambah Alamat
          </button>
        )}
      </div>

      {addresses.length === 0 && editingId !== 'NEW' && (
        <p className="text-slate-500 font-medium bg-slate-50 p-3 rounded-2xl border border-slate-200 text-[11px]">
          Belum ada alamat. Tambah Rumah, Kantor, atau Apartemen untuk checkout jemput cepat.
        </p>
      )}

      {addresses.map((row) =>
        editingId === row.id ? (
          <AddressForm
            key={row.id}
            label={label}
            fullAddress={fullAddress}
            asPrimary={asPrimary}
            pin={pin}
            busy={busy}
            submitLabel="Simpan Perubahan"
            onLabel={setLabel}
            onAddress={setFullAddress}
            onPrimary={setAsPrimary}
            onPin={setPin}
            onSubmit={submit}
            onCancel={cancel}
          />
        ) : (
          <div key={row.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-black text-slate-800 inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-500" /> {row.label}
                  {row.is_primary && (
                    <span className="bg-blue-600 text-white text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full">
                      Utama
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{row.full_address}</p>
                {row.latitude != null && row.longitude != null && (
                  <p className="text-[9px] text-emerald-600 font-bold mt-1">Pin {Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!row.is_primary && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSetPrimary(row.id)}
                  className="text-[10px] font-extrabold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg inline-flex items-center gap-1"
                >
                  <Star className="w-3 h-3" /> Jadikan Utama
                </button>
              )}
              <button
                type="button"
                onClick={() => startEdit(row)}
                className="text-[10px] font-extrabold text-blue-600 bg-white border border-slate-200 px-2 py-1 rounded-lg inline-flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Hapus alamat "${row.label}"?`)) return;
                  onDelete(row.id);
                }}
                className="text-[10px] font-extrabold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-1 rounded-lg inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Hapus
              </button>
            </div>
          </div>
        )
      )}

      {editingId === 'NEW' && (
        <AddressForm
          label={label}
          fullAddress={fullAddress}
          asPrimary={asPrimary}
          pin={pin}
          busy={busy}
          submitLabel="Simpan Alamat"
          onLabel={setLabel}
          onAddress={setFullAddress}
          onPrimary={setAsPrimary}
          onPin={setPin}
          onSubmit={submit}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

function AddressForm({
  label,
  fullAddress,
  asPrimary,
  pin,
  busy,
  submitLabel,
  onLabel,
  onAddress,
  onPrimary,
  onPin,
  onSubmit,
  onCancel
}: {
  label: string;
  fullAddress: string;
  asPrimary: boolean;
  pin: GeoPoint | null;
  busy?: boolean;
  submitLabel: string;
  onLabel: (v: string) => void;
  onAddress: (v: string) => void;
  onPrimary: (v: boolean) => void;
  onPin: (pt: GeoPoint) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const skipGeocode = useRef(false);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;
  const [geoStatus, setGeoStatus] = useState<'idle' | 'searching' | 'found' | 'miss'>('idle');
  const bootstrapped = useRef(false);

  useEffect(() => {
    const q = fullAddress.trim();
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      if (pin) return;
    }
    if (skipGeocode.current) {
      skipGeocode.current = false;
      return;
    }
    if (q.length < 8) {
      setGeoStatus('idle');
      return;
    }
    setGeoStatus('searching');
    const t = window.setTimeout(() => {
      void geocodeAddress(q).then((pt) => {
        if (!pt) {
          setGeoStatus('miss');
          return;
        }
        setGeoStatus('found');
        onPinRef.current({ lat: pt.lat, lng: pt.lng });
      });
    }, 900);
    return () => window.clearTimeout(t);
  }, [fullAddress]);

  const grabGps = () => {
    if (!navigator.geolocation) return alert('GPS tidak tersedia di perangkat ini.');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onPin(pt);
        const label = await reverseGeocodeAddress(pt.lat, pt.lng);
        if (label) {
          skipGeocode.current = true;
          onAddress(label);
        }
      },
      () => alert('Gagal mengambil GPS. Izinkan lokasi di browser.'),
      { enableHighAccuracy: true }
    );
  };

  return (
    <div className="space-y-2 bg-white border border-blue-100 rounded-2xl p-3">
      <div className="flex flex-wrap gap-1.5">
        {ADDRESS_LABEL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onLabel(preset)}
            className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
              label === preset ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            {preset}
          </button>
        ))}
        {!ADDRESS_LABEL_PRESETS.includes(label as (typeof ADDRESS_LABEL_PRESETS)[number]) && (
          <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-lg bg-slate-800 text-white">{label}</span>
        )}
      </div>
      <input
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder="Label (Rumah / Kantor / Apartemen)"
        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
      />
      <textarea
        value={fullAddress}
        onChange={(e) => onAddress(e.target.value)}
        placeholder="Tulis alamat lengkap — pin peta akan ikut pindah..."
        className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3 text-xs text-slate-800 font-medium"
        rows={3}
      />
      {geoStatus === 'searching' && (
        <p className="text-[9px] text-indigo-600 font-bold">Mencari titik di peta dari alamat…</p>
      )}
      {geoStatus === 'miss' && (
        <p className="text-[9px] text-amber-700 font-bold">Alamat belum ketemu di peta. Geser pin ke rumah/gerbang.</p>
      )}
      <PinpointMap value={pin} onChange={onPin} onGps={grabGps} />
      <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
        <input type="checkbox" checked={asPrimary} onChange={(e) => onPrimary(e.target.checked)} />
        Jadikan alamat utama (checkout jemput)
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSubmit}
          className="flex-1 bg-blue-600 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-slate-100 text-slate-600 font-bold px-3 py-2.5 rounded-xl text-xs"
        >
          Batal
        </button>
      </div>
    </div>
  );
}
