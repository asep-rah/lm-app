'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function ExpensePage() {
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [category, setCategory] = useState('Detergen & Parfum');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);

  useEffect(() => {
    async function loadOutlets() {
      const { data } = await supabase.from('outlets').select('*');
      if (data) setOutlets(data);
    }
    loadOutlets();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet || !amount) return;

    setIsSubmitting(true);
    const { error } = await supabase.from('expenses').insert([
      {
        outlet_id: selectedOutlet,
        category: category,
        amount: Number(amount),
        description: description,
      },
    ]);

    if (error) {
      alert('Gagal simpan pengeluaran: ' + error.message);
    } else {
      setAmount('');
      setDescription('');
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 3000);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 flex flex-col items-center">
      {/* HEADER PENGELUARAN */}
      <div className="w-full max-w-xl flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-rose-400">💸 Input Pengeluaran Outlet</h1>
          <p className="text-xs text-slate-400">Pencatatan Beban Operasional Cabang</p>
        </div>
        <Link href="/" className="text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
          ← Ke Dashboard
        </Link>
      </div>

      {/* FORM PENGELUARAN */}
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        {successMsg && (
          <div className="mb-4 p-3 bg-rose-500/20 border border-rose-500 text-rose-300 rounded-xl text-xs text-center font-bold">
            ✅ Catatan Pengeluaran Berhasil Disimpan & Masuk ke Laporan Pusat!
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Pilih Cabang Outlet</label>
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:border-rose-500"
              required
            >
              <option value="">-- Pilih Outlet --</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.city})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Kategori Beban / OPEX</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-rose-500"
            >
              <option value="Detergen & Parfum">Detergen & Parfum</option>
              <option value="Tagihan Listrik & Air">Tagihan Listrik & Air</option>
              <option value="Sewa Tempat">Sewa Tempat</option>
              <option value="Gaji Karyawan">Gaji Karyawan</option>
              <option value="Maintenance & Servis">Maintenance & Servis</option>
              <option value="Lain-lain">Lain-lain</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Nominal Biaya (Rp)</label>
            <input
              type="number"
              placeholder="Masukkan nominal, contoh: 150000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-lg font-bold text-rose-400 focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Deskripsi / Catatan Bukti</label>
            <input
              type="text"
              placeholder="Contoh: Beli parfum aroma lavender 5L di agen"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-6 bg-rose-600 hover:bg-rose-500 text-white font-bold py-3.5 rounded-xl text-sm transition shadow-lg shadow-rose-600/20"
          >
            {isSubmitting ? 'Proses Simpan...' : '💸 SIMPAN PENGELUARAN'}
          </button>
        </form>
      </div>
    </div>
  );
}