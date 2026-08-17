'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

interface Outlet {
  id: string;
  name: string;
}

export default function PickupOrderForm() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const [form, setForm] = useState({
    outlet_id: '',
    customer_name: '',
    customer_phone: '',
    pickup_address: '',
    kiloan_package: 'Cuci Kering Gosok',
    satuan_package: '-',
    qty: '1 kantong',
    wash_process: 'gabung',
    has_valuables: false,
    laundry_bag: false,
    has_fading: false,
    service_type: 'reguler',
    notes: '',
    on_completion: 'tunggu konfirmasi',
  });

  useEffect(() => {
    async function fetchOutlets() {
      const { data, error } = await supabase.from('outlets').select('id, name');
      if (error) {
        console.error('Gagal mengambil data outlet:', error.message);
      }
      if (data && data.length > 0) {
        setOutlets(data);
        setForm((prev) => ({ ...prev, outlet_id: data[0].id }));
      }
    }
    fetchOutlets();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    // 1. TAHAN EVENT REFRESH BROWSER
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);
    setSuccessMsg('');

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

    try {
      // 2. INSERT DATA KE SUPABASE
      const { data, error } = await supabase.from('pickup_orders').insert([
        {
          order_number: orderNumber,
          customer_name: form.customer_name,
          customer_phone: form.customer_phone,
          pickup_address: form.pickup_address,
          kiloan_package: form.kiloan_package,
          satuan_package: form.satuan_package,
          qty: form.qty,
          wash_process: form.wash_process,
          has_valuables: form.has_valuables,
          laundry_bag: form.laundry_bag,
          has_fading: form.has_fading,
          service_type: form.service_type,
          notes: form.notes,
          on_completion: form.on_completion,
          outlet_id: form.outlet_id || null,
          status: 'PENDING_DRIVER',
          pickup_date: new Date().toISOString(),
        },
      ]);

      if (error) {
        // Tampilkan error RLS atau koneksi jika ada
        alert(`❌ Gagal Simpan ke Supabase: ${error.message}`);
        console.error('Supabase Error:', error);
      } else {
        setSuccessMsg('🎉 Order berhasil dibuat! Notifikasi otomatis terkirim ke Telegram outlet.');
        setForm((prev) => ({
          ...prev,
          notes: '',
        }));
      }
    } catch (err: any) {
      alert(`⚠️ Terjadi kesalahan sistem: ${err.message || err}`);
      console.error('System Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl text-slate-100">
      <div className="border-b border-slate-800 pb-3 mb-4">
        <h2 className="text-base font-black text-white flex items-center gap-2">
          <span>🧺</span> Buat Order Pickup Baru
        </h2>
        <p className="text-[11px] text-slate-400 mt-0.5">Lengkapi rincian cucian Anda untuk penjemputan driver.</p>
      </div>

      {successMsg && (
        <div className="p-3 mb-4 text-xs font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 rounded-2xl animate-in zoom-in-95">
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Pilih Outlet</label>
          <select
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
            value={form.outlet_id}
            onChange={(e) => setForm({ ...form, outlet_id: e.target.value })}
            required
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id} className="bg-slate-900 text-white">{o.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Nama Lengkap</label>
            <input
              type="text"
              required
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              placeholder="Masukkan nama Anda"
            />
          </div>
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">No. WhatsApp</label>
            <input
              type="tel"
              required
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              value={form.customer_phone}
              onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
              placeholder="0812xxxxxxx"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Alamat Penjemputan / Shareloc</label>
          <textarea
            required
            rows={2}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            value={form.pickup_address}
            onChange={(e) => setForm({ ...form, pickup_address: e.target.value })}
            placeholder="Tuliskan alamat lengkap atau link Google Maps..."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Paket Kiloan</label>
            <input
              type="text"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white focus:outline-none focus:border-blue-500"
              value={form.kiloan_package}
              onChange={(e) => setForm({ ...form, kiloan_package: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Cuci Satuan</label>
            <input
              type="text"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white focus:outline-none focus:border-blue-500"
              value={form.satuan_package}
              onChange={(e) => setForm({ ...form, satuan_package: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Jumlah Estimasi</label>
            <input
              type="text"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white focus:outline-none focus:border-blue-500"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Proses Cuci</label>
            <select
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
              value={form.wash_process}
              onChange={(e) => setForm({ ...form, wash_process: e.target.value })}
            >
              <option value="gabung" className="bg-slate-900 text-white">Gabung</option>
              <option value="pisah" className="bg-slate-900 text-white">Pisah</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Layanan</label>
            <select
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-bold text-white focus:outline-none focus:border-blue-500"
              value={form.service_type}
              onChange={(e) => setForm({ ...form, service_type: e.target.value })}
            >
              <option value="reguler" className="bg-slate-900 text-white">Reguler</option>
              <option value="express" className="bg-slate-900 text-white">Express</option>
            </select>
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-2xl space-y-2.5 my-2">
          <label className="flex items-center space-x-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-700 text-blue-600 focus:ring-0 bg-slate-900"
              checked={form.has_valuables}
              onChange={(e) => setForm({ ...form, has_valuables: e.target.checked })}
            />
            <span className="text-xs font-semibold text-slate-300">Ada barang berharga di dalam pakaian?</span>
          </label>
          <label className="flex items-center space-x-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-700 text-blue-600 focus:ring-0 bg-slate-900"
              checked={form.laundry_bag}
              onChange={(e) => setForm({ ...form, laundry_bag: e.target.checked })}
            />
            <span className="text-xs font-semibold text-slate-300">Menggunakan Tas Cucian khusus?</span>
          </label>
          <label className="flex items-center space-x-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-700 text-blue-600 focus:ring-0 bg-slate-900"
              checked={form.has_fading}
              onChange={(e) => setForm({ ...form, has_fading: e.target.checked })}
            />
            <span className="text-xs font-semibold text-slate-300">Ada pakaian yang mudah luntur?</span>
          </label>
        </div>

        <div>
          <label className="block text-[11px] font-extrabold text-slate-300 uppercase tracking-wider mb-1">Catatan Khusus</label>
          <textarea
            rows={2}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            placeholder="Contoh: Tanpa parfum, dilipat rapi..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-3.5 rounded-2xl text-xs shadow-lg shadow-blue-900/40 transition active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Mengirim Order...' : '🚀 KIRIM ORDER PICKUP'}
        </button>
      </form>
    </div>
  );
}