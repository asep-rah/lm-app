'use client';

import { useEffect, useState } from 'react';
import OwnerShowcaseNav from '@/components/OwnerShowcaseNav';
import { supabase } from '@/lib/supabaseClient';
import { updateWithFallback } from '@/lib/safeWrite';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { parseOutletImages } from '@/lib/outletShowcase';
import { uploadShowcaseFile } from '@/lib/uploadProof';

type OutletRow = Record<string, any>;

export default function OwnerOutletShowcasePage() {
  const [ready, setReady] = useState(false);
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [addressDetail, setAddressDetail] = useState('');
  const [operatingHours, setOperatingHours] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [rating, setRating] = useState('5.0');
  const [reviewCount, setReviewCount] = useState('0');
  const [comingSoon, setComingSoon] = useState(false);
  const [openingNote, setOpeningNote] = useState('');
  const [images, setImages] = useState<string[]>([]);

  const selected = outlets.find((o) => o.id === selectedId);

  const applyOutlet = (row: OutletRow | undefined) => {
    if (!row) return;
    setAddressDetail(String(row.address_detail || ''));
    setOperatingHours(String(row.operating_hours || ''));
    setLat(row.latitude != null && row.latitude !== '' ? String(row.latitude) : '');
    setLon(row.longitude != null && row.longitude !== '' ? String(row.longitude) : '');
    setPlaceId(String(row.google_place_id || ''));
    setMapsUrl(String(row.google_maps_url || ''));
    setRating(row.google_rating != null ? String(row.google_rating) : '5.0');
    setReviewCount(row.google_review_count != null ? String(row.google_review_count) : '0');
    setComingSoon(Boolean(row.is_coming_soon));
    setOpeningNote(String(row.opening_date_info || ''));
    setImages(parseOutletImages(row.images));
  };

  const load = async () => {
    const { data } = await supabase.from('outlets').select('*').order('name');
    const rows = data || [];
    setOutlets(rows);
    setSelectedId((prev) => {
      const next = prev && rows.some((o) => o.id === prev) ? prev : rows[0]?.id || '';
      const row = rows.find((o) => o.id === next);
      applyOutlet(row);
      return next;
    });
  };

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = String(JSON.parse(raw).role || '').toLowerCase();
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
    load();
  }, []);

  useEffect(() => {
    applyOutlet(outlets.find((o) => o.id === selectedId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadShowcaseFile(file, `outlet_${selectedId || 'new'}`, ['outlet-photos']);
        if (url) uploaded.push(url);
      }
      setImages((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return alert('Pilih outlet dulu. Tambah cabang baru dari Settings.');
    setSaving(true);
    const payload = {
      address_detail: addressDetail.trim(),
      operating_hours: operatingHours.trim(),
      latitude: lat ? Number(lat) : null,
      longitude: lon ? Number(lon) : null,
      google_place_id: placeId.trim() || null,
      google_maps_url: mapsUrl.trim() || null,
      google_rating: Number(rating) > 0 ? Number(rating) : 5,
      google_review_count: Math.max(0, Math.round(Number(reviewCount) || 0)),
      is_coming_soon: comingSoon,
      opening_date_info: openingNote.trim() || null,
      images
    };
    const { error } = await updateWithFallback(
      'outlets',
      [
        payload,
        { ...payload, images: JSON.stringify(images) },
        {
          address_detail: payload.address_detail,
          operating_hours: payload.operating_hours,
          latitude: payload.latitude,
          longitude: payload.longitude,
          is_coming_soon: payload.is_coming_soon,
          opening_date_info: payload.opening_date_info
        },
        { latitude: payload.latitude, longitude: payload.longitude }
      ],
      { column: 'id', value: selectedId }
    );
    setSaving(false);
    if (error) return alert('Gagal menyimpan profil outlet: ' + error.message);
    alert('Profil outlet berhasil disimpan.');
    await load();
  };

  if (!ready) return <div className="p-6 text-sm text-slate-500">Memuat…</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900">Profil Outlet & Google Business</h1>
          <p className="text-xs text-slate-500 mt-0.5">Foto, jam buka, koordinat, Coming Soon, dan rating Google untuk Customer App.</p>
        </div>
        <OwnerShowcaseNav active="outlets" />
      </div>

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm space-y-4 max-w-3xl">
        <div>
          <label className="text-[10px] font-bold text-slate-600 block mb-1">Pilih Outlet</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 bg-slate-50"
          >
            {outlets.length === 0 && <option value="">Belum ada outlet — tambah di Settings</option>}
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.is_coming_soon ? ' · Coming Soon' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-600 block mb-1">Foto Outlet (bisa banyak)</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-sky-700"
          />
          {uploading && <p className="text-[11px] text-sky-600 mt-1">Mengunggah foto…</p>}
          {images.length > 0 && (
            <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
              {images.map((src, i) => (
                <div key={`${src.slice(0, 40)}-${i}`} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded"
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-600 block mb-1">Alamat lengkap</label>
          <textarea
            value={addressDetail}
            onChange={(e) => setAddressDetail(e.target.value)}
            rows={2}
            placeholder="Jl. …, kecamatan, kota"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-600 block mb-1">Jam operasional</label>
          <input
            value={operatingHours}
            onChange={(e) => setOperatingHours(e.target.value)}
            placeholder="Setiap hari 07.00–21.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Latitude</label>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-6.9056" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono bg-slate-50" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Longitude</label>
            <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="107.5956" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono bg-slate-50" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Google Place ID</label>
            <input value={placeId} onChange={(e) => setPlaceId(e.target.value)} placeholder="ChIJ…" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono bg-slate-50" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Google Maps URL</label>
            <input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="https://maps.google.com/…" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Rating fallback</label>
            <input type="number" step="0.1" min="1" max="5" value={rating} onChange={(e) => setRating(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Jumlah ulasan fallback</label>
            <input type="number" min="0" value={reviewCount} onChange={(e) => setReviewCount(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50" />
          </div>
        </div>
        <p className="text-[10px] text-slate-400 -mt-2">Dipakai jika Google Places API key belum dikonfigurasi.</p>

        <label className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <input type="checkbox" checked={comingSoon} onChange={(e) => setComingSoon(e.target.checked)} />
          <span className="text-xs font-bold text-amber-900">Coming Soon / Outlet Baru</span>
        </label>
        {comingSoon && (
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Catatan tanggal buka</label>
            <input
              value={openingNote}
              onChange={(e) => setOpeningNote(e.target.value)}
              placeholder="Grand opening September 2026"
              className="w-full border border-amber-200 rounded-xl px-3 py-2 text-sm bg-amber-50"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !selectedId}
          className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm"
        >
          {saving ? 'Menyimpan…' : `Simpan profil${selected ? ` · ${selected.name}` : ''}`}
        </button>
      </form>
    </div>
  );
}
