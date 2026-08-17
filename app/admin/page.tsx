'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
// 1. IMPORT KOMPONEN AI ASSISTANT ADMIN
import AdminAIAssistant from '@/components/AdminAIAssistant';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function SuperAdminPage() {
  const [services, setServices] = useState<any[]>([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceUnit, setNewServiceUnit] = useState('kg');
  const [isLoading, setIsLoading] = useState(false);

  const fetchServices = async () => {
    const { data } = await supabase.from('services').select('*').order('id', { ascending: true });
    if (data) setServices(data);
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await supabase.from('services').insert([
      {
        name: newServiceName,
        price: Number(newServicePrice),
        unit: newServiceUnit,
      },
    ]);

    if (error) {
      alert('Gagal menambah layanan: ' + error.message);
    } else {
      setNewServiceName('');
      setNewServicePrice('');
      fetchServices(); // Refresh tabel
    }
    setIsLoading(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Yakin ingin menghapus layanan ini?')) return;
    await supabase.from('services').delete().eq('id', id);
    fetchServices();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* HEADER PAGE */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-black text-indigo-400">👑 Super Admin Panel</h1>
            <p className="text-sm text-slate-400">Kelola Master Data Sistem Laundry</p>
          </div>
          <Link href="/" className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-sm transition">
            Kembali
          </Link>
        </div>

        {/* 2. WIDGET AI EXECUTIVE COPILOT & CHURN DETECTOR */}
        <AdminAIAssistant />

        {/* GRID UTAMA (FORM & TABEL MASTER DATA) */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* FORM TAMBAH LAYANAN */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl h-fit">
            <h2 className="text-lg font-bold text-white mb-4 border-b border-slate-800 pb-2">➕ Tambah Layanan Baru</h2>
            <form onSubmit={handleAddService} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Nama Layanan</label>
                <input
                  type="text"
                  placeholder="Contoh: Cuci Karpet"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Harga Dasar (Rp)</label>
                <input
                  type="number"
                  placeholder="Contoh: 15000"
                  value={newServicePrice}
                  onChange={(e) => setNewServicePrice(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Satuan</label>
                <select
                  value={newServiceUnit}
                  onChange={(e) => setNewServiceUnit(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none"
                >
                  <option value="kg">Per Kilo (Kg)</option>
                  <option value="pcs">Per Potong (Pcs)</option>
                  <option value="meter">Per Meter</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-lg text-sm transition"
              >
                {isLoading ? 'Menyimpan...' : 'Simpan Layanan'}
              </button>
            </form>
          </div>

          {/* TABEL DAFTAR LAYANAN */}
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-lg font-bold text-white mb-4 border-b border-slate-800 pb-2">📋 Daftar Layanan Tersedia</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="py-2">No</th>
                    <th className="py-2">Nama Layanan</th>
                    <th className="py-2">Harga</th>
                    <th className="py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((srv, index) => (
                    <tr key={srv.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-3 text-slate-500">{index + 1}</td>
                      <td className="py-3 font-semibold text-slate-200">{srv.name}</td>
                      <td className="py-3 text-emerald-400 font-bold">
                        Rp {Number(srv.price).toLocaleString('id-ID')} <span className="text-xs text-slate-500 font-normal">/ {srv.unit}</span>
                      </td>
                      <td className="py-3">
                        <button 
                          onClick={() => handleDelete(srv.id)}
                          className="text-xs bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white px-2 py-1 rounded transition"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}