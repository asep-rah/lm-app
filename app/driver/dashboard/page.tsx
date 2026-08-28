'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import RoleTaskInbox from '@/components/RoleTaskInbox';
import { logCourierStage, updatePickupOrder } from '@/lib/pickupUpdates';
import KpiRoleMonitoring from '@/components/KpiRoleMonitoring';
import SwipeToAction from '@/components/ui/SwipeToAction';
import StatusBadge from '@/components/ui/StatusBadge';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

const ACTIVE_STATUSES = [
  'Baru Masuk',
  'Driver Menuju Lokasi',
  'Barang Dibawa ke Outlet',
  'Ready for Delivery',
  'Siap Diantar',
  'Driver Mengantar'
];

const isDeliveryJob = (status: any) => {
  const s = String(status || '').toLowerCase();
  return s.includes('delivery') || s.includes('antar') || s.includes('mengantar');
};

const pickupAddress = (p: any) =>
  String(p?.address || p?.customer_address || p?.notes || '').trim() || 'Alamat belum diisi';

export default function DriverDashboard() {
  const [pickups, setPickups] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [driverName, setDriverName] = useState('Driver Internal');
  const [driverOutletId, setDriverOutletId] = useState('');
  const [loginRole, setLoginRole] = useState('driver');
  const [driverTab, setDriverTab] = useState<'jobs' | 'inbox' | 'account'>('jobs');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const gpsFailed = useRef(false);
  const driverNameRef = useRef('Driver Internal');

  const loadDriverTasks = async (outletId?: string) => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('pickup_orders')
        .select('*')
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: true });

      const branch = outletId ?? driverOutletId;
      if (branch) query = query.eq('outlet_id', branch);

      const { data, error } = await query;
      if (data) setPickups(data);
      if (error) console.error('Gagal memuat tugas:', error.message);
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    const driverStr = localStorage.getItem('laundry_user');
    let outletId = '';
    if (driverStr) {
      try {
        const parsed = JSON.parse(driverStr);
        const name = parsed.name || 'Driver Internal';
        setDriverName(name);
        driverNameRef.current = name;
        setLoginRole(String(parsed.role || 'driver').toLowerCase());
        outletId = String(parsed.outlet_id || '');
        setDriverOutletId(outletId);
      } catch {
        /* ignore */
      }
    }

    loadDriverTasks(outletId);

    let watchId: number | undefined;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          if (gpsFailed.current) return;
          const { latitude, longitude } = pos.coords;
          const { error } = await supabase
            .from('pickup_orders')
            .update({ driver_lat: latitude, driver_lon: longitude })
            .eq('driver_name', driverNameRef.current)
            .in('status', ['Driver Menuju Lokasi', 'Driver Mengantar']);
          if (error) gpsFailed.current = true;
        },
        (err) => console.log('GPS tracking inactive:', err.message),
        { enableHighAccuracy: true }
      );
    }

    const driverChannel = supabase
      .channel('driver_pickup_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, () => {
        loadDriverTasks(outletId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(driverChannel);
      if (watchId && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    if (confirm('Apakah Anda yakin ingin keluar dari Portal Driver?')) {
      localStorage.removeItem('laundry_user');
      window.location.href = '/login';
    }
  };

  const handleAcceptTask = async (order: any) => {
    const now = new Date().toISOString();
    const delivery = isDeliveryJob(order.status);
    const payload = {
      status: delivery ? 'Driver Mengantar' : 'Driver Menuju Lokasi',
      driver_name: driverName,
      accepted_at: now
    };
    const { error } = await updatePickupOrder(order.id, payload);
    if (!error) {
      await logCourierStage(order, delivery ? 'Driver Mengantar' : 'Jemput Driver', driverName);
      toast(
        delivery
          ? 'Tugas antar diterima. GPS aktif.'
          : 'Tugas jemput diterima. GPS aktif.',
        'ok'
      );
      loadDriverTasks();
    } else {
      toast('Gagal mengambil tugas: ' + error.message, 'err');
    }
  };

  const handleOpenMaps = (order: any) => {
    if (order.lat && order.lon) {
      return window.open(`https://www.google.com/maps/dir/?api=1&destination=${order.lat},${order.lon}`, '_blank');
    }

    const targetAddress = pickupAddress(order);
    if (!targetAddress || targetAddress === 'Alamat belum diisi') {
      return alert('Alamat lokasi pelanggan belum diatur.');
    }

    const cleanAddress = targetAddress.replace(/^Alamat:\s*/i, '').trim();
    const query = encodeURIComponent(cleanAddress);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
  };

  const handleOpenCall = (phone: string) => {
    let clean = (phone || '').trim().replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.slice(1);
    if (!clean) return toast('Nomor pelanggan kosong', 'warn');
    window.open(`tel:+${clean}`, '_self');
  };

  const handleOpenWA = (phone: string, delivery = false) => {
    let cleanPhone = (phone || '').trim().replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    const msg = encodeURIComponent(
      delivery
        ? `Halo Kak, saya Driver Laundrivery (${driverName}) yang bertugas mengantar cucian Kakak. Saya sedang menuju ke lokasi ya Kak!`
        : `Halo Kak, saya Driver Laundrivery (${driverName}) yang bertugas menjemput cucian Kakak. Saya sedang menuju ke lokasi ya Kak!`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
  };

  const photoLabel = (status: string) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('siap') || status === 'Ready for Delivery') return 'WAJIB: FOTO AMBIL CUCIAN DI OUTLET';
    if (status === 'Driver Mengantar') return 'WAJIB: FOTO SERAH TERIMA PELANGGAN';
    if (status === 'Driver Menuju Lokasi' || status === 'Baru Masuk') return 'WAJIB: FOTO JEMPUT DI LOKASI CUSTOMER';
    return 'WAJIB: FOTO SERAH TERIMA DI OUTLET';
  };

  const handleFileUploadAndFinish = async (
    e: React.ChangeEvent<HTMLInputElement>,
    order: any
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const currentStatus = String(order.status || '');
    const st = currentStatus.toLowerCase();
    const isOutletPickup = st.includes('siap') || currentStatus === 'Ready for Delivery';
    const isPickupStep = currentStatus === 'Driver Menuju Lokasi' || currentStatus === 'Baru Masuk';
    const isDeliveryStep = currentStatus === 'Driver Mengantar';
    const confirmMsg = isOutletPickup
      ? 'Foto live wajib: ambil cucian di outlet sebelum berangkat ke pelanggan.'
      : isPickupStep
      ? 'Foto live wajib: bukti pengambilan pakaian di lokasi customer.'
      : isDeliveryStep
      ? 'Foto live wajib: bukti penyerahan cucian ke pelanggan.'
      : 'Foto live wajib: bukti penyerahan pakaian di outlet.';

    if (!confirm(confirmMsg)) return;

    setUploadingId(order.id);

    try {
      const photoType = isOutletPickup ? 'outlet-pickup' : isPickupStep ? 'pickup' : isDeliveryStep ? 'delivery' : 'outlet';
      const cleanFileName = `${photoType}-${order.id}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('pickup-photos')
        .upload(cleanFileName, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        throw new Error('Storage Error: ' + uploadError.message);
      }

      const { data: publicUrlData } = supabase.storage
        .from('pickup-photos')
        .getPublicUrl(cleanFileName);

      const photoUrl = publicUrlData.publicUrl;
      const now = new Date().toISOString();

      let updateData: Record<string, any>;
      let stageLabel = 'Tiba di Outlet';
      if (isOutletPickup) {
        updateData = {
          photo_outlet_url: photoUrl,
          status: 'Driver Mengantar',
          picked_up_at: now,
          arrived_outlet_at: now,
          driver_name: driverName
        };
        stageLabel = 'Ambil di Outlet';
      } else if (isPickupStep) {
        updateData = { photo_url: photoUrl, status: 'Barang Dibawa ke Outlet', picked_up_at: now, driver_name: driverName };
        stageLabel = 'Jemput Driver';
      } else if (isDeliveryStep) {
        updateData = {
          photo_delivery_url: photoUrl,
          photo_outlet_url: order.photo_outlet_url || photoUrl,
          status: 'Terkirim',
          delivered_at: now,
          driver_name: driverName
        };
        stageLabel = 'Selesai';
      } else {
        updateData = { photo_outlet_url: photoUrl, status: 'Telah Tiba di Outlet', arrived_outlet_at: now, driver_name: driverName };
        stageLabel = 'Tiba di Outlet';
      }

      const { error: updateError } = await updatePickupOrder(order.id, updateData);
      if (updateError) {
        throw new Error('DB Error: ' + updateError.message);
      }

      await logCourierStage({ ...order, _proofUrl: photoUrl }, stageLabel, driverName);

      alert(
        isOutletPickup
          ? '📷 Foto ambil di outlet tersimpan. Lanjut antar ke pelanggan.'
          : isPickupStep
          ? '📷 Foto jemput berhasil! Lanjutkan perjalanan ke Outlet.'
          : isDeliveryStep
          ? '📦 Foto serah terima pelanggan tersimpan. Tugas antar selesai.'
          : '🏪 Foto serah terima outlet berhasil! Tugas jemput selesai.'
      );
      loadDriverTasks();
    } catch (err: any) {
      alert('⚠️ Gagal mengirim foto: ' + (err.message || 'Terjadi kesalahan jaringan'));
    } finally {
      setUploadingId(null);
    }
  };

  const waitingAccept = (status: string) => status === 'Baru Masuk';

  const phoneOf = (p: any) => p.customer_phone || p.phone_number || '';

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center pb-24 font-sans">
      <div className="bg-slate-50 w-full max-w-md min-h-screen flex flex-col relative">
        <div className="bg-white border-b border-slate-200/80 p-5 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Kurir</p>
              <h1 className="text-xl font-black tracking-tight text-slate-900">Tugas hari ini</h1>
            </div>
            <button
              onClick={() => loadDriverTasks()}
              className="bg-slate-50 border border-slate-200 text-slate-700 text-[10px] font-bold px-3 py-1.5 rounded-full active:scale-95 transition"
            >
              Refresh
            </button>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl flex items-center justify-between border border-slate-200/80">
            <div>
              <p className="text-[9px] text-slate-400 font-bold uppercase">Bertugas</p>
              <p className="font-black text-slate-900">{driverName}</p>
            </div>
            <StatusBadge tone="emerald">{pickups.length} aktif</StatusBadge>
          </div>
        </div>

        <div className="p-4 flex-1 space-y-4">
          {driverTab === 'inbox' && (
            <div className="space-y-4">
              <KpiRoleMonitoring />
              <RoleTaskInbox role={loginRole || 'driver'} />
            </div>
          )}

          {driverTab === 'account' && (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-3">
              <p className="text-sm font-black text-slate-900">{driverName}</p>
              <p className="text-xs text-slate-400">Role {loginRole}</p>
              <button
                onClick={handleLogout}
                className="w-full bg-rose-50 border border-rose-200 text-rose-700 font-bold text-xs py-3 rounded-xl"
              >
                Keluar
              </button>
            </div>
          )}

          {driverTab === 'jobs' && (
            <>
          {isLoading && (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          <div className="space-y-4">
            {pickups.map((p, index) => (
              <div key={p.id} className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    #{index + 1} · {p.order_number || 'ORDER'}
                  </span>
                  <StatusBadge tone={waitingAccept(p.status) ? 'amber' : 'sky'}>{p.status}</StatusBadge>
                </div>

                <div>
                  <h3 className="font-black text-slate-900 text-base leading-tight">
                    {p.customer_name || 'Pelanggan'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{phoneOf(p)}</p>
                  <p className="text-xs font-semibold text-slate-700 mt-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    {pickupAddress(p)}
                  </p>
                </div>

                <p className="text-[11px] text-slate-500">
                  {p.service_type} · {p.estimated_weight || '3'} Kg · Ongkir Rp {Number(p.delivery_fee || 0).toLocaleString('id-ID')}
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleOpenMaps(p)}
                    className="flex flex-col items-center justify-center bg-sky-50 border border-sky-100 text-sky-700 font-bold p-2.5 rounded-xl text-[10px]"
                  >
                    Maps
                  </button>
                  <button
                    onClick={() => handleOpenWA(phoneOf(p), isDeliveryJob(p.status))}
                    className="flex flex-col items-center justify-center bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold p-2.5 rounded-xl text-[10px]"
                  >
                    WhatsApp
                  </button>
                  <button
                    onClick={() => handleOpenCall(phoneOf(p))}
                    className="flex flex-col items-center justify-center bg-amber-50 border border-amber-100 text-amber-700 font-bold p-2.5 rounded-xl text-[10px]"
                  >
                    Telepon
                  </button>
                </div>

                {waitingAccept(p.status) ? (
                  <SwipeToAction
                    label={isDeliveryJob(p.status) ? 'Geser untuk antar' : 'Geser untuk jemput'}
                    doneLabel="Diterima"
                    onComplete={() => handleAcceptTask(p)}
                  />
                ) : (
                  <label className="block w-full">
                    <span className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-3.5 rounded-xl text-xs shadow-sm transition flex items-center justify-center cursor-pointer">
                      {uploadingId === p.id ? 'Mengunggah…' : photoLabel(p.status)}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleFileUploadAndFinish(e, p)}
                      disabled={uploadingId === p.id}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>

          {pickups.length === 0 && !isLoading && (
            <div className="text-center py-16 border border-dashed border-slate-200 rounded-2xl text-slate-400 bg-white">
              <p className="text-sm font-black text-slate-700">Tidak ada tugas.</p>
              <p className="text-[10px] mt-1">Standby di outlet atau cek inbox.</p>
            </div>
          )}
            </>
          )}
        </div>

        <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-slate-200/80 flex justify-around p-2 pb-5 z-50 shadow-sm">
          <button onClick={() => setDriverTab('jobs')} className={`flex flex-col items-center flex-1 py-1 ${driverTab === 'jobs' ? 'text-sky-600' : 'text-slate-400'}`}>
            <span className="text-lg">🛵</span>
            <span className="text-[9px] font-bold mt-0.5">Tugas</span>
          </button>
          <button onClick={() => setDriverTab('inbox')} className={`flex flex-col items-center flex-1 py-1 ${driverTab === 'inbox' ? 'text-emerald-600' : 'text-slate-400'}`}>
            <span className="text-lg">📥</span>
            <span className="text-[9px] font-bold mt-0.5">Inbox</span>
          </button>
          <button onClick={() => setDriverTab('account')} className={`flex flex-col items-center flex-1 py-1 ${driverTab === 'account' ? 'text-amber-600' : 'text-slate-400'}`}>
            <span className="text-lg">👤</span>
            <span className="text-[9px] font-bold mt-0.5">Akun</span>
          </button>
        </nav>
      </div>
    </div>
  );

}
