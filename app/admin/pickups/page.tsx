'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function AdminPickupsPage() {
  const [pickups, setPickups] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const fetchPickups = async () => {
    setLoading(true);
    const { data: dbOutlets } = await supabase.from('outlets').select('*');
    if (dbOutlets) setOutlets(dbOutlets);

    let query = supabase
      .from('pickup_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (selectedOutlet !== 'ALL') {
      query = query.eq('outlet_id', selectedOutlet);
    }

    const { data, error } = await query;
    if (!error && data) {
      setPickups(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPickups();

    const channel = supabase
      .channel('pickup_orders_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, () => {
        fetchPickups();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedOutlet]);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from('pickup_orders')
      .update({ status: newStatus })
      .eq('id', id);

    if (!error) {
      fetchPickups();
    } else {
      alert('Gagal update status: ' + error.message);
    }
  };

  const newOrders = pickups.filter(
    (p) => p.status === 'Baru Masuk' || p.status === 'Menunggu Penjemputan' || p.status === 'Menunggu Driver'
  );

  const driverInProcess = pickups.filter(
    (p) => p.status === 'Driver Menuju Lokasi' || p.status === 'Proses Penjemputan'
  );

  const arrivedAtOutlet = pickups.filter(
    (p) => p.status === 'Telah Tiba di Outlet' || p.status === 'Selesai Jemput'
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800/80 p-5 rounded-3xl border border-slate-700/80 backdrop-blur-md mb-6 shadow-xl">
        <div>
          <h1 className="text-xl font-extrabold text-emerald-400 flex items-center gap-2">
            🛵 Monitor Antar-Jemput
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Role Akses: <span className="text-slate-200 font-bold">KASIR / DRIVER</span> | Penerimaan Fisik Cucian oleh Outlet
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs font-bold text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">📍 Semua Outlet</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                📍 {o.name}
              </option>
            ))}
          </select>

          <Link
            href="/pos"
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition"
          >
            Portal Kasir
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <div className="bg-slate-800/50 border border-slate-700/80 rounded-3xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-3">
            <h2 className="text-sm font-extrabold text-rose-400 flex items-center gap-2">
              🚨 Baru Masuk
            </h2>
            <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-black px-2.5 py-0.5 rounded-full">
              {newOrders.length}
            </span>
          </div>

          <div className="space-y-3">
            {newOrders.map((item) => (
              <div key={item.id} className="bg-slate-800 border border-slate-700/90 rounded-2xl p-4 space-y-3 shadow-md hover:border-slate-600 transition">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-100">{item.customer_name || 'Pelanggan Online'}</h3>
                    <p className="text-[11px] font-mono text-emerald-400">{item.phone_number || item.customer_phone || item.phone || '-'}</p>
                  </div>
                  <span className="text-[10px] bg-rose-500/20 text-rose-300 font-bold px-2 py-0.5 rounded-md border border-rose-500/30">
                    {item.status}
                  </span>
                </div>

                <div className="text-xs text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
                  <p className="font-bold text-slate-200">{item.service_type}</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{item.notes || '-'}</p>
                </div>

                <div className="flex justify-between items-center text-xs pt-1">
                  <span className="text-slate-400 text-[10px]">Ongkir: <strong className="text-emerald-400">Rp {Number(item.delivery_fee || 0).toLocaleString('id-ID')}</strong></span>
                  <button
                    onClick={() => handleUpdateStatus(item.id, 'Driver Menuju Lokasi')}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-[11px] px-3 py-1.5 rounded-xl shadow-md transition"
                  >
                    Tugaskan Driver 🛵
                  </button>
                </div>
              </div>
            ))}

            {newOrders.length === 0 && (
              <div className="text-center py-10 text-xs text-slate-500 font-medium">
                Belum ada orderan baru.
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/80 rounded-3xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-3">
            <h2 className="text-sm font-extrabold text-amber-400 flex items-center gap-2">
              🛵 Driver Dalam Proses
            </h2>
            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-black px-2.5 py-0.5 rounded-full">
              {driverInProcess.length}
            </span>
          </div>

          <div className="space-y-3">
            {driverInProcess.map((item) => (
              <div key={item.id} className="bg-slate-800 border border-slate-700/90 rounded-2xl p-4 space-y-3 shadow-md hover:border-slate-600 transition">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-100">{item.customer_name || 'Pelanggan Online'}</h3>
                    <p className="text-[11px] font-mono text-emerald-400">{item.phone_number || item.customer_phone || item.phone || '-'}</p>
                  </div>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded-md border border-amber-500/30">
                    {item.status}
                  </span>
                </div>

                <div className="text-xs text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
                  <p className="font-bold text-slate-200">{item.service_type}</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{item.notes || '-'}</p>
                </div>

                <button
                  onClick={() => handleUpdateStatus(item.id, 'Telah Tiba di Outlet')}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs py-2.5 rounded-xl shadow-md transition flex items-center justify-center gap-2"
                >
                  📦 Driver Tiba / Terima Fisik Cucian
                </button>
              </div>
            ))}

            {driverInProcess.length === 0 && (
              <div className="text-center py-10 text-xs text-slate-500 font-medium">
                Tidak ada driver sedang menjemput.
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/80 rounded-3xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-3">
            <h2 className="text-sm font-extrabold text-emerald-400 flex items-center gap-2">
              📦 Antrean Masuk POS
            </h2>
            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-black px-2.5 py-0.5 rounded-full">
              {arrivedAtOutlet.length}
            </span>
          </div>

          <div className="space-y-3">
            {arrivedAtOutlet.map((item) => (
              <div key={item.id} className="bg-slate-800 border border-slate-700/90 rounded-2xl p-4 space-y-2 shadow-md">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-100">{item.customer_name || 'Pelanggan Online'}</h3>
                    <p className="text-[10px] text-emerald-400 font-medium mt-0.5">Telah Tiba di Outlet</p>
                  </div>
                  <span className="text-xs font-black text-emerald-400">Rp {Number(item.delivery_fee || 0).toLocaleString('id-ID')}</span>
                </div>

                {item.photo_url && (
                  <div className="rounded-xl overflow-hidden border border-slate-700 mt-2">
                    <p className="text-[9px] font-bold text-slate-400 p-1 bg-slate-900">📸 Foto Bukti Driver:</p>
                    <img src={item.photo_url} alt="Foto Bukti" className="w-full h-24 object-cover" />
                  </div>
                )}

                <p className="text-[10px] text-slate-400 italic pt-1">
                  Cucian telah diterima fisik. Buka <strong className="text-emerald-400">Portal Kasir (POS)</strong> untuk verifikasi berat/pcs dan cetak nota.
                </p>
              </div>
            ))}

            {arrivedAtOutlet.length === 0 && (
              <div className="text-center py-10 text-xs text-slate-500 font-medium">
                Belum ada cucian tiba di outlet.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}