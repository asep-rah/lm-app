'use client';

import { useEffect, useState } from 'react';
import OwnerShowcaseNav from '@/components/OwnerShowcaseNav';
import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { uploadShowcaseFile } from '@/lib/uploadProof';

type PromoRow = {
  id: string;
  title?: string | null;
  banner_url?: string | null;
  description?: string | null;
  outlet_id?: string | null;
  is_active?: boolean | null;
};

export default function OwnerPromoBannersPage() {
  const [ready, setReady] = useState(false);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string }>>([]);
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editId, setEditId] = useState<string | 'NEW'>('NEW');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [outletId, setOutletId] = useState('');
  const [isActive, setIsActive] = useState(true);

  const resetForm = () => {
    setEditId('NEW');
    setTitle('');
    setDescription('');
    setBannerUrl('');
    setOutletId('');
    setIsActive(true);
  };

  const load = async () => {
    const [{ data: outletData }, { data: promoData, error }] = await Promise.all([
      supabase.from('outlets').select('id, name').order('name'),
      supabase.from('promotions').select('*').order('created_at', { ascending: false })
    ]);
    setOutlets(outletData || []);
    if (error) {
      setPromos([]);
      return;
    }
    setPromos(promoData || []);
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

  const fillEdit = (row: PromoRow) => {
    setEditId(row.id);
    setTitle(String(row.title || ''));
    setDescription(String(row.description || ''));
    setBannerUrl(String(row.banner_url || ''));
    setOutletId(String(row.outlet_id || ''));
    setIsActive(row.is_active !== false);
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadShowcaseFile(file, `promo_${Date.now()}`, ['promo-banners']);
      if (url) setBannerUrl(url);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return alert('Judul promo wajib diisi.');
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim(),
      banner_url: bannerUrl.trim() || null,
      outlet_id: outletId || null,
      is_active: isActive
    };
    let error: { message: string } | null = null;
    if (editId === 'NEW') {
      const res = await insertWithFallback('promotions', [
        payload,
        { title: payload.title, description: payload.description, banner_url: payload.banner_url, is_active: payload.is_active },
        { title: payload.title, description: payload.description, is_active: payload.is_active }
      ]);
      error = res.error;
    } else {
      const res = await updateWithFallback(
        'promotions',
        [
          payload,
          { title: payload.title, description: payload.description, banner_url: payload.banner_url, is_active: payload.is_active },
          { title: payload.title, description: payload.description, is_active: payload.is_active }
        ],
        { column: 'id', value: editId }
      );
      error = res.error;
    }
    setSaving(false);
    if (error) return alert('Gagal menyimpan promo: ' + error.message);
    alert(editId === 'NEW' ? 'Banner promo ditambahkan.' : 'Banner promo diperbarui.');
    resetForm();
    await load();
  };

  const toggleActive = async (row: PromoRow) => {
    const next = row.is_active === false;
    const { error } = await updateWithFallback('promotions', [{ is_active: next }], { column: 'id', value: row.id });
    if (error) return alert(error.message);
    await load();
  };

  const removePromo = async (row: PromoRow) => {
    if (!confirm(`Hapus promo "${row.title || 'tanpa judul'}"?`)) return;
    const { error } = await supabase.from('promotions').delete().eq('id', row.id);
    if (error) return alert(error.message);
    if (editId === row.id) resetForm();
    await load();
  };

  if (!ready) return <div className="p-6 text-sm text-slate-500">Memuat…</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900">Promo & Pengumuman</h1>
          <p className="text-xs text-slate-500 mt-0.5">Banner aktif tampil di carousel Customer App. Beda dari voucher kode di Settings.</p>
        </div>
        <OwnerShowcaseNav active="promos" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl">
        <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-800">{editId === 'NEW' ? 'Banner baru' : 'Edit banner'}</h2>
            {editId !== 'NEW' && (
              <button type="button" onClick={resetForm} className="text-[11px] font-bold text-sky-600">
                + Baru
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Gambar banner</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleUpload(e.target.files?.[0] || null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-amber-800"
            />
            {uploading && <p className="text-[11px] text-amber-700 mt-1">Mengunggah banner…</p>}
            {bannerUrl && (
              <div className="mt-2 h-28 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bannerUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Judul</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50" required />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Deskripsi / pengumuman</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">Target outlet</label>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold bg-slate-50">
              <option value="">Semua outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Aktifkan di Customer App
          </label>
          <button type="submit" disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50">
            {saving ? 'Menyimpan…' : editId === 'NEW' ? 'Tambah banner' : 'Perbarui banner'}
          </button>
        </form>

        <div className="space-y-2">
          {promos.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-400">
              Belum ada banner. Jalankan migrasi SQL jika tabel promotions belum ada.
            </div>
          )}
          {promos.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex gap-3">
              <div className="w-20 h-14 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                {p.banner_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.banner_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No img</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-slate-800 truncate">{p.title || 'Tanpa judul'}</p>
                <p className="text-[10px] text-slate-500 truncate">{p.description || '—'}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {p.outlet_id ? outlets.find((o) => o.id === p.outlet_id)?.name || 'Outlet' : 'Semua outlet'}
                  {' · '}
                  {p.is_active === false ? 'Nonaktif' : 'Aktif'}
                </p>
                <div className="flex gap-2 mt-1.5">
                  <button type="button" onClick={() => fillEdit(p)} className="text-[10px] font-bold text-sky-600">
                    Edit
                  </button>
                  <button type="button" onClick={() => toggleActive(p)} className="text-[10px] font-bold text-amber-700">
                    {p.is_active === false ? 'Aktifkan' : 'Nonaktifkan'}
                  </button>
                  <button type="button" onClick={() => removePromo(p)} className="text-[10px] font-bold text-rose-600">
                    Hapus
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
