'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function DriverDashboard() {
  const [pickups, setPickups] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [driverName, setDriverName] = useState('Driver Internal');
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // LOAD TUGAS: MENGAMBIL PESANAN STATUS 'Baru Masuk' DAN 'Driver Menuju Lokasi'
  const loadDriverTasks = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('pickup_orders')
        .select('*')
        .in('status', ['Baru Masuk', 'Driver Menuju Lokasi'])
        .order('created_at', { ascending: true });

      if (data) setPickups(data);
      if (error) console.error('Gagal memuat tugas:', error.message);
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    const driverStr = localStorage.getItem('laundry_user');
    if (driverStr) {
      try {
        const parsed = JSON.parse(driverStr);
        setDriverName(parsed.name || 'Driver Internal');
      } catch (e) {}
    }

    loadDriverTasks();

    // FITUR 1: BROADCAST LIVE GPS KOORDINAT DRIVER KE DATABASE
    let watchId: number;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          await supabase
            .from('pickup_orders')
            .update({ driver_lat: latitude, driver_lon: longitude })
            .eq('status', 'Driver Menuju Lokasi');
        },
        (err) => console.log('GPS tracking inactive:', err.message),
        { enableHighAccuracy: true }
      );
    }

    // Realtime Sync Supabase
    const driverChannel = supabase
      .channel('driver_pickup_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_orders' }, () => {
        loadDriverTasks();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(driverChannel);
      if (watchId && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // AKSI DRIVER MENGAMBIL PESANAN 'Baru Masuk' -> 'Driver Menuju Lokasi'
  const handleAcceptTask = async (orderId: string) => {
    const { error } = await supabase
      .from('pickup_orders')
      .update({ 
        status: 'Driver Menuju Lokasi',
        driver_id: currentDriverId || null,
        accepted_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (!error) {
      alert('🚀 Anda telah menerima tugas ini! Pelanggan dapat memantau lokasi GPS Anda secara live.');
      loadDriverTasks(); // Reload daftar tugas driver
    } else {
      alert('Gagal mengambil tugas: ' + error.message);
    }
  };

  const handleOpenMaps = (addressOrCoords: string, notes?: string) => {
    let targetAddress = addressOrCoords;

    // Jika addressOrCoords kosong/undefined, cari teks 'Alamat: ...' dari notes
    if ((!targetAddress || targetAddress === 'undefined') && notes) {
      const match = notes.match(/Alamat:\s*([^|]+)/i);
      if (match && match[1]) {
        targetAddress = match[1].trim();
      }
    }

    if (!targetAddress || targetAddress === 'undefined' || targetAddress === 'Belum diisi') {
      return alert('Alamat lokasi pelanggan belum diatur.');
    }

    const query = encodeURIComponent(targetAddress);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
    window.open(mapsUrl, '_blank');
  };

  const handleOpenWA = (phone: string) => {
    let cleanPhone = (phone || '').trim().replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    const msg = encodeURIComponent(`Halo Kak, saya Driver Laundrivery (${driverName}) yang bertugas menjemput cucian Kakak. Saya sedang menuju ke lokasi ya Kak! 🛵💨`);
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
  };

  // FITUR DUAL FOTO BUKTI: FOTO 1 (LOKASI CUSTOMER) & FOTO 2 (TIBA DI OUTLET)
  const handleFileUploadAndFinish = async (e: React.ChangeEvent<HTMLInputElement>, orderId: string, currentStatus: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPickupStep = currentStatus === 'Driver Menuju Lokasi';
    const confirmMsg = isPickupStep 
      ? 'Upload foto bukti pengambilan pakaian di lokasi customer?' 
      : 'Upload foto bukti penyerahan pakaian di outlet?';

    if (!confirm(confirmMsg)) return;

    setUploadingId(orderId);
    const photoType = isPickupStep ? 'pickup' : 'outlet';
    const fileName = `proofs/${photoType}-${orderId}-${Date.now()}.jpg`;

    // Upload ke Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('pickup-photos')
      .upload(fileName, file);

    if (uploadError) {
      alert('Gagal mengunggah foto: ' + uploadError.message);
      setUploadingId(null);
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from('pickup-photos')
      .getPublicUrl(fileName);

    const photoUrl = publicUrlData.publicUrl;

    // Update DB sesuai tahapan foto
    const updateData: any = isPickupStep
      ? { photo_url: photoUrl, status: 'Barang Dibawa ke Outlet' }
      : { photo_outlet_url: photoUrl, status: 'Telah Tiba di Outlet' };

    const { error: updateError } = await supabase
      .from('pickup_orders')
      .update(updateData)
      .eq('id', orderId);

    setUploadingId(null);

    if (!updateError) {
      alert(isPickupStep ? '📷 Foto jemput berhasil! Lanjutkan perjalanan ke Outlet.' : '🏪 Foto serah terima outlet berhasil! Tugas Selesai.');
      loadDriverTasks();
    } else {
      alert('Gagal memperbarui status: ' + updateError.message);
    }
  };
    
  return (
    <div className="min-h-screen bg-slate-100 flex justify-center pb-24 font-sans">
      <div className="bg-slate-50 w-full max-w-md min-h-screen shadow-2xl flex flex-col relative">
        
        {/* HEADER DRIVER */}
        <div className="bg-emerald-700 text-white p-5 rounded-b-3xl shadow-lg border-b border-emerald-900">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h1 className="text-xl font-black tracking-tight flex items-center gap-1.5">
                <span>Portal Driver</span>
                <span className="text-[10px] bg-emerald-900 text-white px-2 py-0.5 rounded-full font-bold">LIVE GPS</span>
              </h1>
              <p className="text-[10px] text-emerald-100 font-medium">🛵 Aplikasi Kurir Internal Laundrivery</p>
            </div>
            <button onClick={loadDriverTasks} className="bg-emerald-800 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-sm active:scale-95 transition">
              🔄 Refresh
            </button>
          </div>
          
          <div className="bg-emerald-900/40 p-3 rounded-2xl flex items-center justify-between border border-emerald-600/50">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">👷‍♂️</span>
              <div className="text-xs">
                <p className="text-[9px] text-emerald-200 font-bold uppercase">Selamat Bertugas</p>
                <p className="font-black text-white">{driverName}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-emerald-200">Tugas Aktif</p>
              <p className="font-black text-lg text-white">{pickups.length}</p>
            </div>
          </div>
        </div>

        {/* DAFTAR TUGAS */}
        <div className="p-4 flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider">
              📋 Daftar Titik Jemput Hari Ini
            </h2>
          </div>

          {isLoading && <p className="text-center text-xs font-bold text-slate-500 animate-pulse py-4">Mencari tugas baru...</p>}

          <div className="space-y-4">
            {pickups.map((p, index) => (
              <div key={p.id} className="bg-white border-2 border-emerald-500/20 rounded-3xl p-4 shadow-md space-y-3 relative overflow-hidden">
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    #{index + 1} - {p.order_number || 'ORDER'}
                  </span>
                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${p.status === 'Baru Masuk' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                    {p.status}
                  </span>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Pelanggan</p>
                  <h3 className="font-black text-slate-900 text-base leading-tight mt-0.5">
                    {p.customer_name || 'Pelanggan'} ({p.customer_phone || p.phone_number})
                  </h3>
                  <p className="text-xs font-bold text-slate-700 mt-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    📍 {p.notes || 'Alamat Penjemputan'}
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl space-y-1">
                  <p className="text-[10px] font-bold text-amber-900 uppercase">📦 Rincian Barang yang Dijemput:</p>
                  <p className="text-xs text-amber-950 font-medium">Layanan: <b className="font-black">{p.service_type}</b></p>
                  <p className="text-xs text-amber-950 font-medium">Est. Bawaan: <b className="font-black">{p.estimated_weight || '3'} Kg</b></p>
                  <p className="text-xs text-amber-950 font-medium">Ongkir Tagihan: <b className="font-black text-blue-700">Rp {Number(p.delivery_fee || 0).toLocaleString('id-ID')}</b></p>
                </div>

                {/* LOGIKA TOMBOL BERDASARKAN STATUS */}
                {p.status === 'Baru Masuk' ? (
                  <button
                    onClick={() => handleAcceptTask(p.id)}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-3 rounded-xl text-xs shadow-md transition active:scale-95 flex items-center justify-center gap-2"
                  >
                    🛵 TERIMA & JEMPUT SEKARANG
                  </button>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                      <button 
                        onClick={() => handleOpenMaps(p.address || '', p.notes || '')}
                        className="flex flex-col items-center justify-center bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold p-3 rounded-xl transition active:scale-95"
                      >
                        <span className="text-xl mb-1">🗺️</span>
                        <span className="text-[10px]">Buka Maps</span>
                      </button>
                      <button 
                        onClick={() => handleOpenWA(p.customer_phone || p.phone_number)}
                        className="flex flex-col items-center justify-center bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold p-3 rounded-xl transition active:scale-95"
                      >
                        <span className="text-xl mb-1">💬</span>
                        <span className="text-[10px]">Chat Pelanggan</span>
                      </button>
                    </div>

                    <label className="block w-full mt-2">
                      <span className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3.5 rounded-xl text-xs shadow-lg transition active:scale-95 flex justify-center items-center gap-2 cursor-pointer">
                        📸 {uploadingId === p.id ? 'Mengunggah Foto...' : 'AMBIL FOTO BUKTI & FINISH'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleFileUploadAndFinish(e, p.id)}
                        disabled={uploadingId === p.id}
                      />
                    </label>
                  </>
                )}

              </div>
            ))}

            {pickups.length === 0 && !isLoading && (
              <div className="text-center py-16 border-2 border-dashed border-slate-300 rounded-3xl text-slate-500">
                <span className="text-5xl block mb-3 opacity-50">☕</span>
                <p className="text-sm font-black">Tidak ada tugas penjemputan.</p>
                <p className="text-[10px] mt-1">Silakan istirahat atau standby di outlet.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}