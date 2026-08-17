'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function AdminOutlets() {
  const [outlets, setOutlets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // State Form Edit / Tambah
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  const loadOutlets = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('outlets').select('*').order('created_at', { ascending: true });
    if (data) setOutlets(data);
    if (error) alert('Gagal memuat data: ' + error.message);
    setIsLoading(false);
  };

  useEffect(() => {
    loadOutlets();
  }, []);

  const handleEditClick = (outlet: any) => {
    setEditId(outlet.id);
    setName(outlet.name || '');
    setAddress(outlet.address || '');
    setLat(outlet.latitude ? String(outlet.latitude) : '');
    setLon(outlet.longitude ? String(outlet.longitude) : '');
    setMsg('');
  };

  const handleCancelEdit = () => {
    setEditId(null);
    setName(''); setAddress(''); setLat(''); setLon('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMsg('');

    const payload = {
      name,
      address,
      latitude: Number(lat),
      longitude: Number(lon)
    };

    if (editId) {
      // Update Outlet Lama
      const { error } = await supabase.from('outlets').update(payload).eq('id', editId);
      if (!error) { setMsg('✅ Data Outlet berhasil diperbarui!'); handleCancelEdit(); loadOutlets(); }
      else setMsg('❌ Gagal update: ' + error.message);
    } else {
      // Tambah Outlet Baru
      const { error } = await supabase.from('outlets').insert([payload]);
      if (!error) { setMsg('✅ Outlet Baru berhasil ditambahkan!'); handleCancelEdit(); loadOutlets(); }
      else setMsg('❌ Gagal tambah: ' + error.message);
    }
    
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, outletName: string) => {
    if (!confirm(`HAPUS OUTLET?\nApakah Anda yakin ingin menghapus permanen cabang "${outletName}"?`)) return;
    const { error } = await supabase.from('outlets').delete().eq('id', id);
    if (!error) { alert('✅ Outlet berhasil dihapus!'); loadOutlets(); }
    else alert('❌ Gagal hapus (Mungkin outlet ini masih terhubung dengan data transaksi): ' + error.message);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* HEADER ADMIN */}
        <div className="bg-slate-900 text-white rounded-3xl p-8 shadow-xl flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black tracking-tight">🏢 Manajemen Outlet</h1>
            <p className="text-blue-200 mt-1">Laundrivery Pro - Master Data Cabang</p>
          </div>
          <button onClick={() => handleEditClick({})} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl transition shadow-lg">
            ➕ TAMBAH CABANG BARU
          </button>
        </div>

        {/* NOTIFIKASI */}
        {msg && (
          <div className="bg-emerald-100 border border-emerald-300 text-emerald-900 p-4 rounded-xl font-bold">
            {msg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* KOLOM KIRI: DAFTAR OUTLET */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-black text-slate-800 border-b pb-2">📋 Daftar Cabang Aktif</h2>
            
            {isLoading ? (
              <p className="text-slate-500 font-bold">Memuat data outlet...</p>
            ) : outlets.length === 0 ? (
              <p className="text-slate-500">Belum ada data outlet.</p>
            ) : (
              outlets.map((o) => (
                <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col md:flex-row justify-between gap-4 md:items-center">
                  <div>
                    <h3 className="text-xl font-black text-slate-900">{o.name}</h3>
                    <p className="text-sm text-slate-500 mt-1">{o.address || 'Alamat belum diisi'}</p>
                    <div className="mt-2 flex gap-3 text-xs font-mono bg-slate-100 p-2 rounded-lg inline-block text-slate-700">
                      <span>Lat: {o.latitude}</span> | <span>Lon: {o.longitude}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEditClick(o)} className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-bold px-4 py-2 rounded-xl transition">
                      ✏️ EDIT
                    </button>
                    <button onClick={() => handleDelete(o.id, o.name)} className="bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold px-4 py-2 rounded-xl transition">
                      🗑️ HAPUS
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* KOLOM KANAN: FORM EDIT / TAMBAH */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xl h-fit sticky top-6">
            <h2 className="text-lg font-black text-blue-900 border-b pb-2 mb-4">
              {editId ? '✏️ Edit Data Outlet' : '✨ Tambah Outlet Baru'}
            </h2>
            
            {editId !== null ? (
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Nama Cabang</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Briwash Pasirkaliki" className="w-full border rounded-xl p-3 text-sm font-bold bg-slate-50" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Alamat Lengkap</label>
                  <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Alamat lengkap outlet..." className="w-full border rounded-xl p-3 text-sm bg-slate-50" rows={2} />
                </div>
                
                <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl space-y-3">
                  <p className="text-[10px] font-bold text-blue-800 uppercase">📍 Titik Koordinat (Google Maps)</p>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Latitude (Garis Lintang)</label>
                    <input type="text" value={lat} onChange={e => setLat(e.target.value)} placeholder="Contoh: -6.9056" className="w-full border rounded-xl p-2.5 text-sm font-mono bg-white" required />
                    <p className="text-[9px] text-slate-400 mt-1">*Di Indonesia, Latitude biasanya pakai minus (-)</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Longitude (Garis Bujur)</label>
                    <input type="text" value={lon} onChange={e => setLon(e.target.value)} placeholder="Contoh: 107.5956" className="w-full border rounded-xl p-2.5 text-sm font-mono bg-white" required />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-900 hover:bg-blue-950 text-white font-black py-3 rounded-xl transition shadow-md">
                    {isSubmitting ? 'Menyimpan...' : '💾 SIMPAN'}
                  </button>
                  <button type="button" onClick={handleCancelEdit} className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-3 px-4 rounded-xl transition">
                    BATAL
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-12 px-4 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
                <span className="text-4xl block mb-2">🏢</span>
                <p className="text-sm font-bold text-slate-500">Pilih "EDIT" pada daftar outlet, atau klik tombol "TAMBAH CABANG BARU" di atas.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}