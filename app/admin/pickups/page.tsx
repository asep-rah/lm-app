'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { getStaffSession, isCsRole, isOutletLockedRole } from '@/lib/staffSession';
import { updateWithFallback } from '@/lib/safeWrite';
import { isPickupConvertedToPos } from '@/lib/pickupUpdates';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function AdminPickupsPage() {
  const [pickups, setPickups] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>(() => {
    if (typeof window === 'undefined') return 'kasir';
    return getStaffSession().role || localStorage.getItem('user_role') || 'kasir';
  });

  const fetchPickups = async () => {
    setLoading(true);

    // 1. Fetch data outlet
    const { data: dbOutlets } = await supabase.from('outlets').select('*');
    if (dbOutlets) setOutlets(dbOutlets);

    const session = getStaffSession();
    const savedOutlet = session.outletId || localStorage.getItem('user_outlet_id') || localStorage.getItem('outlet_id');
    const savedRole = session.role || localStorage.getItem('user_role') || 'kasir';
    const locked = isOutletLockedRole(savedRole);

    setCurrentUserRole(savedRole);

    let activeOutletId = selectedOutlet;
    if (locked && savedOutlet && savedOutlet !== 'ALL') {
      activeOutletId = savedOutlet;
      if (selectedOutlet !== savedOutlet) setSelectedOutlet(savedOutlet);
    } else if (!activeOutletId && savedOutlet && locked) {
      activeOutletId = savedOutlet;
      setSelectedOutlet(savedOutlet);
    }

    // 3. Query data pickup order
    let query = supabase
      .from('pickup_orders')
      .select('*')
      .order('created_at', { ascending: false });

    const currentOutlet = locked
      ? (savedOutlet && savedOutlet !== 'ALL' ? savedOutlet : '')
      : (selectedOutlet || activeOutletId || savedOutlet || '');

    if (locked) {
      if (!currentOutlet) {
        setPickups([]);
        setLoading(false);
        return;
      }
      query = query.eq('outlet_id', currentOutlet);
    } else if (currentOutlet && currentOutlet !== 'ALL') {
      query = query.eq('outlet_id', currentOutlet);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        fetchPickups();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedOutlet]);
  const handleUpdateStatus = async (id: string, newStatus: string) => {
    const session = getStaffSession();
    if (isOutletLockedRole(session.role) && session.outletId && session.outletId !== 'ALL') {
      const target = pickups.find((p) => p.id === id);
      if (target?.outlet_id && String(target.outlet_id) !== String(session.outletId)) {
        alert('Pesanan ini milik outlet lain. Kasir hanya dapat memproses pesanan cabang sendiri.');
        return;
      }
    }

    const { error } = await updateWithFallback(
      'pickup_orders',
      [{ status: newStatus }],
      { column: 'id', value: id }
    );

    if (!error) {
      fetchPickups();
    } else {
      alert('Gagal update status: ' + error.message);
    }
  };

  const newOrders = pickups.filter(
    (p) =>
      p.status === 'Baru Masuk' ||
      p.status === 'Menunggu Kurir' ||
      p.status === 'Pickup Request' ||
      p.status === 'Menunggu Penjemputan' ||
      p.status === 'Menunggu Driver'
  );

  const driverInProcess = pickups.filter(
    (p) => p.status === 'Driver Menuju Lokasi' || p.status === 'Proses Penjemputan'
  );

  const arrivedAtOutlet = pickups.filter(
    (p) =>
      !isPickupConvertedToPos(p) &&
      (p.status === 'Telah Tiba di Outlet' ||
        p.status === 'Tiba di Outlet' ||
        p.status === 'Selesai Jemput')
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans selection:bg-emerald-500 selection:text-slate-900">
      {/* HEADER SECTION */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/80 border border-slate-800 p-5 md:p-6 rounded-3xl backdrop-blur-xl mb-8 shadow-2xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></span>
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              🛵 Monitor Antar-Jemput
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Role Akses:{' '}
            <span className="text-emerald-400 font-bold uppercase tracking-wider">
              {isCsRole(currentUserRole) ? currentUserRole.replace('_', ' ') : 'KASIR / DRIVER'}
            </span>{' '}
            | Live Monitoring Kanban Board
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
        <select
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
            disabled={isOutletLockedRole(currentUserRole)}
            className={`bg-slate-800 border border-slate-700 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-200 focus:outline-none ${
              isOutletLockedRole(currentUserRole) ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            {!isOutletLockedRole(currentUserRole) && <option value="ALL">📍 Semua Outlet</option>}
            {(isOutletLockedRole(currentUserRole)
              ? outlets.filter((o: any) => o.id === selectedOutlet)
              : outlets
            ).map((o: any) => (
              <option key={o.id} value={o.id}>
                📍 {o.name}
              </option>
            ))}
          </select>

          {isCsRole(currentUserRole) ? (
            <Link
              href="/cs"
              className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-black px-5 py-2.5 rounded-2xl text-xs shadow-lg shadow-sky-500/20 transition-all whitespace-nowrap active:scale-95"
            >
              Workspace CS ➔
            </Link>
          ) : (
            <Link
              href="/pos"
              className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black px-5 py-2.5 rounded-2xl text-xs shadow-lg shadow-emerald-500/20 transition-all whitespace-nowrap active:scale-95"
            >
              Portal Kasir ➔
            </Link>
          )}
        </div>
      </div>

      {/* KANBAN BOARD GRID */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* KOLOM 1: BARU MASUK */}
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-5 space-y-4 backdrop-blur-md shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center border-b border-slate-800/80 pb-3 mb-4">
              <h2 className="text-sm font-black text-rose-400 flex items-center gap-2 tracking-wider uppercase">
                🚨 Baru Masuk
              </h2>
              <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-black px-3 py-1 rounded-full shadow-sm">
                {newOrders.length}
              </span>
            </div>

            <div className="space-y-3">
              {newOrders.map((item) => (
                <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg hover:border-slate-700 transition-all">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-100">{item.customer_name || 'Pelanggan Online'}</h3>
                      <p className="text-[11px] font-mono text-emerald-400 font-semibold">{item.phone_number || item.customer_phone || item.phone || '-'}</p>
                    </div>
                    <span className="text-[10px] bg-rose-500/10 text-rose-300 font-extrabold px-2.5 py-1 rounded-xl border border-rose-500/20">
                      {item.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 bg-slate-800/60 p-3 rounded-xl border border-slate-800 space-y-1">
                    <p className="font-bold text-slate-100">{item.service_type}</p>
                    <p className="text-[10px] text-slate-400 leading-relaxed">{item.notes || '-'}</p>
                  </div>

                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className="text-slate-400 text-[10px]">Ongkir: <strong className="text-emerald-400 font-black">Rp {Number(item.delivery_fee || 0).toLocaleString('id-ID')}</strong></span>
                    <button
                      onClick={() => handleUpdateStatus(item.id, 'Driver Menuju Lokasi')}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-[11px] px-3.5 py-1.5 rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95"
                    >
                      Tugaskan Driver 🛵
                    </button>
                  </div>
                </div>
              ))}

              {newOrders.length === 0 && (
                <div className="text-center py-12 text-xs text-slate-500 font-bold border border-dashed border-slate-800 rounded-2xl">
                  Belum ada orderan baru.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* KOLOM 2: DRIVER DALAM PROSES */}
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-5 space-y-4 backdrop-blur-md shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center border-b border-slate-800/80 pb-3 mb-4">
              <h2 className="text-sm font-black text-amber-400 flex items-center gap-2 tracking-wider uppercase">
                🛵 Driver Dalam Proses
              </h2>
              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-black px-3 py-1 rounded-full shadow-sm">
                {driverInProcess.length}
              </span>
            </div>

            <div className="space-y-3">
              {driverInProcess.map((item) => (
                <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg hover:border-slate-700 transition-all">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-100">{item.customer_name || 'Pelanggan Online'}</h3>
                      <p className="text-[11px] font-mono text-emerald-400 font-semibold">{item.phone_number || item.customer_phone || item.phone || '-'}</p>
                    </div>
                    <span className="text-[10px] bg-amber-500/10 text-amber-300 font-extrabold px-2.5 py-1 rounded-xl border border-amber-500/20">
                      {item.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 bg-slate-800/60 p-3 rounded-xl border border-slate-800 space-y-1">
                    <p className="font-bold text-slate-100">{item.service_type}</p>
                    <p className="text-[10px] text-slate-400 leading-relaxed">{item.notes || '-'}</p>
                  </div>

                  <button
                    onClick={() => handleUpdateStatus(item.id, 'Telah Tiba di Outlet')}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    📦 Driver Tiba / Terima Fisik Cucian
                  </button>
                </div>
              ))}

              {driverInProcess.length === 0 && (
                <div className="text-center py-12 text-xs text-slate-500 font-bold border border-dashed border-slate-800 rounded-2xl">
                  Tidak ada driver sedang menjemput.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* KOLOM 3: ANTREAN MASUK POS */}
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-3xl p-5 space-y-4 backdrop-blur-md shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center border-b border-slate-800/80 pb-3 mb-4">
              <h2 className="text-sm font-black text-emerald-400 flex items-center gap-2 tracking-wider uppercase">
                📦 Antrean Masuk POS
              </h2>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-black px-3 py-1 rounded-full shadow-sm">
                {arrivedAtOutlet.length}
              </span>
            </div>

            <div className="space-y-3">
              {arrivedAtOutlet.map((item) => {
                const customerPhone = item.phone_number || item.customer_phone || item.phone || '';
                const customerName = item.customer_name || 'Pelanggan Online';
                const posUrl = `/pos?pickup_id=${item.id}&name=${encodeURIComponent(customerName)}&phone=${encodeURIComponent(customerPhone)}&service=${encodeURIComponent(item.service_type || '')}&notes=${encodeURIComponent(item.notes || '')}&delivery_fee=${item.delivery_fee || 0}&order_type=Online`;

                return (
                  <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg hover:border-slate-700 transition-all">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-extrabold text-sm text-slate-100">{customerName}</h3>
                        <p className="text-[11px] font-mono text-emerald-400 font-semibold">{customerPhone || '-'}</p>
                        <p className="text-[10px] text-emerald-400 font-bold mt-0.5">✓ Telah Tiba di Outlet</p>
                      </div>
                      <span className="text-xs font-black text-emerald-400">Rp {Number(item.delivery_fee || 0).toLocaleString('id-ID')}</span>
                    </div>

                    <div className="text-xs text-slate-300 bg-slate-800/60 p-3 rounded-xl border border-slate-800 space-y-1">
                      <p className="font-bold text-slate-100">{item.service_type}</p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">{item.notes || '-'}</p>
                    </div>

                    {item.photo_url && (
                      <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
                        <p className="text-[9px] font-bold text-slate-400 p-1.5 bg-slate-800/60 border-b border-slate-800 flex items-center gap-1">
                          📸 Foto Bukti Driver:
                        </p>
                        <img src={item.photo_url} alt="Foto Bukti" className="w-full h-28 object-cover hover:scale-105 transition-all duration-300" />
                      </div>
                    )}

                    <Link
                      href={posUrl}
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2 mt-2"
                    >
                      🧾 PROSES DI POS KASIR ➔
                    </Link>
                  </div>
                );
              })}

              {arrivedAtOutlet.length === 0 && (
                <div className="text-center py-12 text-xs text-slate-500 font-bold border border-dashed border-slate-800 rounded-2xl">
                  Belum ada cucian tiba di outlet.
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}