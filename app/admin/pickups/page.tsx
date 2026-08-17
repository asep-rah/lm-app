'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function MonitorPickupsPage() {
  const [pickups, setPickups] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState<string>('ALL');
  const [userRole, setUserRole] = useState<string>('kasir');
  const [assignedDriverMap, setAssignedDriverMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const userStr = localStorage.getItem('laundry_user') || localStorage.getItem('laundry_owner_user');
    if (userStr) {
      const u = JSON.parse(userStr);
      setUserRole(u.role || 'kasir');
      if (u.outlet_id && u.outlet_id !== 'ALL') {
        setSelectedOutlet(u.outlet_id);
      }
    }
    loadData();

    // Auto-Sync Realtime
    const channel = supabase.channel('pickup_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, () => loadData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    const [{ data: pData }, { data: dData }, { data: oData }] = await Promise.all([
      supabase.from('pickup_orders').select('*, outlets(name)').order('created_at', { ascending: false }),
      supabase.from('employees').select('*').eq('role', 'driver'),
      supabase.from('outlets').select('*')
    ]);

    if (pData) setPickups(pData);
    if (dData) setDrivers(dData);
    if (oData) setOutlets(oData);
    setIsLoading(false);
  };

  // CS / MANAGEMENT MEMERINTAHKAN DRIVER
  const handleAssignDriver = async (pickupId: string) => {
    const driverName = assignedDriverMap[pickupId];
    if (!driverName) return alert('Pilih driver terlebih dahulu!');

    const { error } = await supabase.from('pickup_orders').update({
      driver_name: driverName,
      status: 'Driver Menuju Lokasi'
    }).eq('id', pickupId);

    if (!error) {
      alert('✅ Driver berhasil ditugaskan oleh CS!');
      loadData();
    } else alert('❌ Gagal: ' + error.message);
  };

  // KARYAWAN OUTLET KLIK SAAT DRIVER TIBA DI OUTLET (OTOMATIS MASUK POS)
  const handleArrivedAtOutlet = async (pickup: any) => {
    if (!confirm(`Konfirmasi penerimaan fisik cucian dari ${pickup.customer_name}? Data akan otomatis diteruskan ke Portal Kasir (POS).`)) return;

    // 1. Update status pickup
    await supabase.from('pickup_orders').update({
      status: 'Tiba di Outlet'
    }).eq('id', pickup.id);

    // 2. Otomatis buat Draft Transaksi ke tabel transactions agar masuk ke POS
    const draftResi = 'TRX-' + Math.floor(100000 + Math.random() * 900000);
    const { error: txErr } = await supabase.from('transactions').insert([{
      receipt_number: draftResi,
      outlet_id: pickup.outlet_id,
      customer_name: pickup.customer_name,
      customer_phone: pickup.customer_phone || null,
      service_type: pickup.service_type || 'Cuci Kering Gosok',
      weight_kg: Number(pickup.estimated_weight) || 0,
      pcs_count: Number(pickup.estimated_pcs) || 0,
      amount: Number(pickup.estimated_price) || 0,
      notes: pickup.notes || 'Orderan Jemputan Driver',
      order_type: 'Online',
      status: 'Pending Verifikasi Kasir'
    }]);

    if (!txErr) {
      alert(`✅ Cucian Diterima! Draft transaksi ${draftResi} otomatis masuk ke Portal Kasir.`);
      loadData();
    } else {
      alert('⚠️ Status diperbarui, namun gagal sync POS: ' + txErr.message);
    }
  };

  const filteredPickups = pickups.filter(p => selectedOutlet === 'ALL' || p.outlet_id === selectedOutlet);
  const baruMasuk = filteredPickups.filter(p => p.status === 'Menunggu Driver' || p.status === 'Baru Masuk');
  const menujuLokasi = filteredPickups.filter(p => p.status === 'Driver Menuju Lokasi' || p.status === 'Cucian Diambil Driver');
  const antreanPOS = filteredPickups.filter(p => p.status === 'Tiba di Outlet');

  const isCSOrAdmin = ['cs', 'owner', 'supervisor', 'admin'].includes(userRole);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER BAR */}
        <div className="bg-slate-800 border border-slate-700 p-4 md:p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-emerald-400 flex items-center gap-2">
              🛵 Monitor Antar-Jemput
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Role Akses: <b className="text-indigo-400 uppercase">{userRole}</b> | {isCSOrAdmin ? 'Penugasan Driver oleh CS' : 'Penerimaan Fisik Cucian oleh Outlet'}
            </p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <select 
              value={selectedOutlet} 
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="bg-slate-900 border border-slate-600 text-xs font-bold text-slate-200 rounded-xl px-3 py-2"
            >
              <option value="ALL">🌐 Semua Outlet</option>
              {outlets.map(o => (<option key={o.id} value={o.id}>📍 {o.name}</option>))}
            </select>
            <Link href="/pos" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition">
              🛒 Portal Kasir
            </Link>
          </div>
        </div>

        {/* 3 KOLOM MONITORING */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* KOLOM 1: BARU MASUK (CS ASSIGN DRIVER) */}
          <div className="bg-slate-800/80 border border-rose-500/30 rounded-3xl p-4 space-y-4">
            <div className="flex justify-between items-center border-b border-rose-500/20 pb-3">
              <h3 className="font-black text-rose-400 text-sm">🚨 Baru Masuk</h3>
              <span className="bg-rose-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full">{baruMasuk.length}</span>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {baruMasuk.map(item => (
                <div key={item.id} className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-sm text-slate-100">{item.customer_name}</h4>
                      <p className="text-[10px] text-slate-400 font-mono">{item.customer_phone || '-'}</p>
                      <span className="text-[10px] text-emerald-400 font-bold block mt-1">📍 {item.outlets?.name}</span>
                    </div>
                    <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-bold">{item.receipt_number || 'PKP'}</span>
                  </div>

                  {/* FORM ASSIGN DRIVER KHUSUS CS / MANAGEMENT */}
                  {isCSOrAdmin ? (
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <label className="text-[10px] font-bold text-indigo-300 block">👔 CS: Utus Driver ke Lokasi</label>
                      <div className="flex gap-1.5">
                        <select
                          value={assignedDriverMap[item.id] || ''}
                          onChange={(e) => setAssignedDriverMap({ ...assignedDriverMap, [item.id]: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-600 rounded-xl p-2 text-xs font-bold text-slate-200"
                        >
                          <option value="">-- Pilih Driver --</option>
                          {drivers.map(d => (<option key={d.id} value={d.name}>{d.name}</option>))}
                        </select>
                        <button
                          onClick={() => handleAssignDriver(item.id)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 rounded-xl shadow"
                        >
                          Utus
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-amber-400 italic bg-amber-950/40 p-2 rounded-xl border border-amber-800/40">
                      ⏳ Menunggu CS menugaskan driver...
                    </p>
                  )}
                </div>
              ))}
              {baruMasuk.length === 0 && <p className="text-xs text-slate-500 text-center py-8">Belum ada orderan baru.</p>}
            </div>
          </div>

          {/* KOLOM 2: DRIVER MENUJU LOKASI (OUTLET KLIK DRIVER TIBA) */}
          <div className="bg-slate-800/80 border border-amber-500/30 rounded-3xl p-4 space-y-4">
            <div className="flex justify-between items-center border-b border-amber-500/20 pb-3">
              <h3 className="font-black text-amber-400 text-sm">🛵 Driver Dalam Proses</h3>
              <span className="bg-amber-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full">{menujuLokasi.length}</span>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {menujuLokasi.map(item => (
                <div key={item.id} className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-sm text-slate-100">{item.customer_name}</h4>
                      <p className="text-[10px] text-amber-400 font-bold">🛵 Driver: {item.driver_name || 'Driver'}</p>
                    </div>
                    <span className="text-[9px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded">{item.status}</span>
                  </div>

                  {/* TOMBOL KARYAWAN OUTLET SAAT DRIVER SAMPAI BAWA CUCIAN */}
                  <button
                    onClick={() => handleArrivedAtOutlet(item)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-xs shadow-lg transition flex items-center justify-center gap-1.5"
                  >
                    📦 Driver Tiba / Terima Fisik Cucian
                  </button>
                </div>
              ))}
              {menujuLokasi.length === 0 && <p className="text-xs text-slate-500 text-center py-8">Tidak ada penjemputan aktif.</p>}
            </div>
          </div>

          {/* KOLOM 3: ANTREAN INPUT POS (AUTOMATICALLY SYNCED) */}
          <div className="bg-slate-800/80 border border-emerald-500/30 rounded-3xl p-4 space-y-4">
            <div className="flex justify-between items-center border-b border-emerald-500/20 pb-3">
              <h3 className="font-black text-emerald-400 text-sm">📦 Antrean Masuk POS</h3>
              <span className="bg-emerald-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full">{antreanPOS.length}</span>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {antreanPOS.map(item => (
                <div key={item.id} className="bg-slate-900 border border-emerald-800/50 rounded-2xl p-4 space-y-2">
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded">Telah Tiba di Outlet</span>
                  <h4 className="font-bold text-sm text-slate-100">{item.customer_name}</h4>
                  <p className="text-[10px] text-slate-400">
                    Cucian telah diterima fisik. Buka <b className="text-emerald-400">Portal Kasir (POS)</b> untuk verifikasi berat/pcs dan cetak nota.
                  </p>
                </div>
              ))}
              {antreanPOS.length === 0 && <p className="text-xs text-slate-500 text-center py-8">Belum ada antrean verifikasi POS.</p>}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}