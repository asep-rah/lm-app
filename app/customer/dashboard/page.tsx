'use client';

import InstallPWA from '@/components/InstallPWA';
import AIChatWidget from '@/components/AIChatWidget';
import React, { useEffect, useState, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

// Database Layanan Satuan Reguler
const SATUAN_ITEMS = [
  { id: '1', name: 'Bedcover Double', price: 40000, estimateDays: 3, unit: 'pcs' },
  { id: '2', name: 'Bedcover Single', price: 25000, estimateDays: 3, unit: 'pcs' },
  { id: '3', name: 'Sprei Double / Single', price: 15000, estimateDays: 3, unit: 'pcs' },
  { id: '4', name: 'Jaket / Hoodie', price: 30000, estimateDays: 3, unit: 'pcs' },
  { id: '5', name: 'Jas / Blazer', price: 30000, estimateDays: 3, unit: 'pcs' },
  { id: '6', name: 'Sepatu', price: 45000, estimateDays: 7, unit: 'pasang' },
  { id: '7', name: 'Karpet', price: 25000, estimateDays: 14, unit: 'm²' },
  { id: '8', name: 'Gordyn', price: 15000, estimateDays: 14, unit: 'm²' },
];

const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function CustomerDashboard() {
  const [customerPhone, setCustomerPhone] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'address' | 'pickup'>('home');

  const [outlets, setOutlets] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [activePickups, setActivePickups] = useState<any[]>([]);
  
  // Modal Notifikasi Cucian Selesai
  const [showFinishedModal, setShowFinishedModal] = useState(false);
  const [finishedOrderData, setFinishedOrderData] = useState<any>(null);

  // Form Tambah / Edit Alamat
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [labelName, setLabelName] = useState('Rumah');
  const [fullAddress, setFullAddress] = useState('');
  const [patokan, setPatokan] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);

  // Form Request Pickup Multi-Service
  const [customerName, setCustomerName] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState('');

  // 1. Kiloan State
  const [useKiloan, setUseKiloan] = useState(true);
  const [kiloanPackage, setKiloanPackage] = useState('Cuci Komplit (Rp 7.000/kg)');
  const [kiloanPricePerKg, setKiloanPricePerKg] = useState(7000);
  const [estimatedKg, setEstimatedKg] = useState<number>(3);

  // 2. Satuan State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSatuanItems, setSelectedSatuanItems] = useState<{ id: string; name: string; price: number; qty: number; estimateDays: number; unit: string }[]>([]);

  // 3. Detail Kondisi Cucian
  const [bagCount, setBagCount] = useState<number>(1);
  const [isSeparated, setIsSeparated] = useState<boolean>(false);
  const [hasFading, setHasFading] = useState<boolean>(false);
  const [hasValuables, setHasValuables] = useState<boolean>(false);

  // 4. Opsi Kecepatan
  const [speed, setSpeed] = useState<'REGULER' | 'ONEDAY' | 'EXPRESS' | 'QUICK'>('REGULER');

  const speedOptions = {
    REGULER: { label: 'Reguler (Standar)', multiplier: 1.0 },
    ONEDAY: { label: 'One Day (+50%)', multiplier: 1.5 },
    EXPRESS: { label: 'Express (+100%)', multiplier: 2.0 },
    QUICK: { label: 'Quick (+200%)', multiplier: 3.0 },
  };

  const [agreeOngkir, setAgreeOngkir] = useState(true);
  const [calculatedNearestOutlet, setCalculatedNearestOutlet] = useState<any>(null);
  const [estimatedFee, setEstimatedFee] = useState(0);
  const [estimatedDistanceKm, setEstimatedDistanceKm] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const custStr = localStorage.getItem('laundrivery_customer');
    if (!custStr) {
      window.location.href = '/customer/login';
      return;
    }
    setCustomerPhone(JSON.parse(custStr).phone);
  }, []);

  const loadCustomerData = async () => {
    if (!customerPhone) return;

    const { data: outletData } = await supabase.from('outlets').select('*');
    if (outletData) setOutlets(outletData);

    const { data: addrData } = await supabase
      .from('customer_addresses')
      .select('*')
      .eq('customer_phone', customerPhone)
      .order('created_at', { ascending: false });

    if (addrData) {
      setAddresses(addrData);
      if (addrData.length > 0 && !selectedAddressId) {
        setSelectedAddressId(addrData[0].id);
        setFullAddress(addrData[0].full_address);
      }
    }

    const { data: txData } = await supabase
      .from('transactions')
      .select('*, outlets(name, address)')
      .eq('customer_phone', customerPhone)
      .order('created_at', { ascending: false });

    if (txData) {
      const active = txData.filter((t) => t.status !== 'Selesai' && t.status !== 'Diambil');
      const finished = txData.filter((t) => t.status === 'Selesai' || t.status === 'Siap Diambil');

      setActiveOrders(active);

      if (finished.length > 0 && !showFinishedModal) {
        setFinishedOrderData(finished[0]);
        setShowFinishedModal(true);
      }
    }

    const { data: pkpData } = await supabase
      .from('pickup_orders')
      .select('*, outlets(name), customer_addresses(*)')
      .eq('customer_phone', customerPhone)
      .neq('status', 'Selesai')
      .neq('status', 'Batal')
      .order('created_at', { ascending: false });
    if (pkpData) setActivePickups(pkpData);
  };

  useEffect(() => {
    loadCustomerData();
  }, [customerPhone, activeTab]);

  const handleDetectGPS = () => {
    if (!navigator.geolocation) return alert('⚠️ HP Anda tidak mendukung GPS!');
    setIsSubmitting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLon(pos.coords.longitude);
        alert(`✅ GPS Berhasil Dideteksi!\nLat: ${pos.coords.latitude}, Lon: ${pos.coords.longitude}`);
        setIsSubmitting(false);
      },
      () => {
        alert('⚠️ Gagal mengambil lokasi GPS! Pastikan Izin Lokasi HP Dinyalakan.');
        setIsSubmitting(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleStartEditAddress = (addr: any) => {
    setEditingAddressId(addr.id);
    setLabelName(addr.label_name || 'Rumah');
    setFullAddress(addr.full_address || '');
    setPatokan(addr.patokan !== '-' ? addr.patokan : '');
    setLat(addr.latitude ? Number(addr.latitude) : null);
    setLon(addr.longitude ? Number(addr.longitude) : null);
  };

  const handleCancelEditAddress = () => {
    setEditingAddressId(null);
    setLabelName('Rumah');
    setFullAddress('');
    setPatokan('');
    setLat(null);
    setLon(null);
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullAddress || lat === null || lon === null) {
      return alert('Mohon isi alamat & pastikan koordinat GPS terisi!');
    }
    setIsSubmitting(true);

    const payload = {
      customer_phone: customerPhone,
      label_name: labelName,
      full_address: fullAddress,
      patokan: patokan || '-',
      latitude: lat,
      longitude: lon,
    };

    let error;
    if (editingAddressId) {
      const res = await supabase.from('customer_addresses').update(payload).eq('id', editingAddressId);
      error = res.error;
    } else {
      const res = await supabase.from('customer_addresses').insert([payload]);
      error = res.error;
    }

    if (!error) {
      setMsg(editingAddressId ? '✅ Alamat berhasil diperbarui!' : '✅ Alamat baru disimpan!');
      handleCancelEditAddress();
      loadCustomerData();
      setActiveTab('pickup');
    } else {
      alert('❌ Gagal simpan: ' + error.message);
    }
    setIsSubmitting(false);
  };

  const handleDeleteAddress = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus alamat ini?')) return;
    const { error } = await supabase.from('customer_addresses').delete().eq('id', id);
    if (!error) {
      setMsg('✅ Alamat berhasil dihapus.');
      loadCustomerData();
    } else alert('Gagal hapus: ' + error.message);
  };

  // Hitung Ongkir
  useEffect(() => {
    if (!selectedAddressId || addresses.length === 0 || outlets.length === 0) return;
    const addr = addresses.find((a) => a.id === selectedAddressId);
    if (!addr || !addr.latitude || !addr.longitude) return;

    let nearest: any = null;
    let minDistanceMeters = Infinity;

    outlets.forEach((o) => {
      if (o.latitude && o.longitude) {
        const dist = getDistanceInMeters(
          Number(addr.latitude),
          Number(addr.longitude),
          Number(o.latitude),
          Number(o.longitude)
        );
        if (dist < minDistanceMeters) {
          minDistanceMeters = dist;
          nearest = o;
        }
      }
    });

    if (!nearest && outlets.length > 0) nearest = outlets[0];
    const distKm = Math.max(0.5, Math.round((minDistanceMeters / 1000) * 10) / 10);
    setEstimatedDistanceKm(distKm);
    setCalculatedNearestOutlet(nearest);

    let oneWayFee = 9000;
    if (distKm > 2) {
      oneWayFee += Math.round((distKm - 2) * 2500);
    }

    const roundTripFee = oneWayFee * 2;
    setEstimatedFee(roundTripFee);
  }, [selectedAddressId, addresses, outlets]);

  const filteredSatuan = useMemo(() => {
    if (!searchQuery) return [];
    return SATUAN_ITEMS.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery]);

  const addSatuanItem = (item: typeof SATUAN_ITEMS[0]) => {
    setSelectedSatuanItems(prev => {
      const exist = prev.find(i => i.id === item.id);
      if (exist) {
        return prev.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...item, qty: 1 }];
    });
    setSearchQuery('');
  };

  const removeSatuanItem = (id: string) => {
    setSelectedSatuanItems(prev => prev.filter(i => i.id !== id));
  };

  // Subtotal Dasar (Kiloan + Satuan Gabungan)
  const subtotalBase = useMemo(() => {
    let kiloanTotal = useKiloan ? kiloanPricePerKg * estimatedKg : 0;
    let satuanTotal = selectedSatuanItems.reduce((acc, curr) => acc + (curr.price * curr.qty), 0);
    return kiloanTotal + satuanTotal;
  }, [useKiloan, kiloanPricePerKg, estimatedKg, selectedSatuanItems]);

  const totalEstimasiLayanan = Math.round(subtotalBase * speedOptions[speed].multiplier);

  const maxEstimateDays = useMemo(() => {
    let daysArr: number[] = [];
    if (useKiloan) daysArr.push(3);
    selectedSatuanItems.forEach(i => daysArr.push(i.estimateDays));

    if (daysArr.length === 0) return '-';
    const baseDays = Math.max(...daysArr);

    if (speed === 'QUICK') return '3 Jam (Kilat)';
    if (speed === 'EXPRESS') return '6 Jam';
    if (speed === 'ONEDAY') return '24 Jam (1 Hari)';
    return `${baseDays} Hari`;
  }, [useKiloan, selectedSatuanItems, speed]);

  const handleSubmitPickup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!useKiloan && selectedSatuanItems.length === 0) {
      alert('Pilih minimal 1 paket Kiloan atau 1 item Satuan!');
      return;
    }
    if (!agreeOngkir) {
      alert('Mohon setujui persetujuan ongkos kirim.');
      return;
    }
    setIsSubmitting(true);

    try {
      // 1. Rincian Layanan
      let details: string[] = [];
      if (useKiloan) {
        details.push(`KILOAN: ${kiloanPackage} (~${estimatedKg}kg)`);
      }
      if (selectedSatuanItems.length > 0) {
        const satuanStr = selectedSatuanItems.map(i => `${i.name} x${i.qty}`).join(', ');
        details.push(`SATUAN: ${satuanStr}`);
      }

      // 2. Gabungkan seluruh informasi ke kolom standar service_type
      const fullServiceString = `${speedOptions[speed].label.toUpperCase()} | ${details.join(' + ')} | Est: ${maxEstimateDays} (Rp ${totalEstimasiLayanan.toLocaleString('id-ID')})`;

      // 3. Waktu penjemputan otomatis (sekarang)
      const nowIso = new Date().toISOString();

      // 4. Payload murni kolom standar Supabase (Termasuk pickup_date)
      const orderData = {
        order_number: 'ONL-' + Math.floor(100000 + Math.random() * 900000),
        customer_phone: customerPhone,
        address_id: selectedAddressId || null,
        outlet_id: calculatedNearestOutlet?.id || null,
        pickup_date: nowIso, // FIX: Mengisi kolom pickup_date yang wajib di Supabase
        distance_km: estimatedDistanceKm,
        delivery_fee: estimatedFee,
        status: 'Menunggu Driver',
        service_type: fullServiceString,
        estimated_weight: useKiloan ? Number(estimatedKg) : 0,
        bag_count: Number(bagCount),
        is_separated: isSeparated,
        has_fading_risk: hasFading,
        has_valuables: hasValuables,
        created_at: nowIso
      };

      const { error } = await supabase.from('pickup_orders').insert([orderData]);

      if (error) throw error;

      alert('🚀 Order Online Berhasil Terkirim!');
      setCustomerName('');
      setSelectedSatuanItems([]);
      loadCustomerData();
      setActiveTab('home');
    } catch (err: any) {
      alert('Gagal mengirim order: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPickup = async (id: string) => {
    if (!confirm('Batalkan order penjemputan ini?')) return;
    setIsSubmitting(true);
    const { error } = await supabase.from('pickup_orders').update({ status: 'Batal' }).eq('id', id);
    if (!error) {
      setMsg('✅ Order penjemputan dibatalkan.');
      loadCustomerData();
    } else alert('Gagal membatalkan: ' + error.message);
    setIsSubmitting(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('laundrivery_customer');
    window.location.href = '/customer/login';
  };

  const getTrackingStep = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s.includes('menunggu pembayaran')) return 1;
    if (s.includes('cuci') || s.includes('proses')) return 2;
    if (s.includes('kering') || s.includes('setrika')) return 3;
    if (s.includes('packing') || s.includes('siap')) return 4;
    if (s.includes('selesai') || s.includes('diambil')) return 5;
    return 1;
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans flex justify-center antialiased pb-28">
      <div className="bg-slate-900 w-full max-w-md min-h-screen shadow-2xl flex flex-col relative text-slate-100 border-x border-slate-800">
        
        {/* Banner PWA Aktif */}
        <div className="p-3">
          <InstallPWA />
        </div>
  
        {/* HEADER APLIKASI */}
        <div className="bg-gradient-to-b from-blue-900/50 via-slate-900 to-slate-900 p-6 rounded-b-[2.5rem] border-b border-blue-500/20 backdrop-blur-xl">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
                  Briwash
                </span>
                <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                  PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">Layanan Premium Antar Jemput Laundry</p>
            </div>
            <button 
              onClick={handleLogout} 
              className="bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold px-3.5 py-1.5 rounded-full border border-slate-700 backdrop-blur-md transition active:scale-95"
            >
              Keluar
            </button>
          </div>

          <div className="bg-gradient-to-r from-blue-950/80 to-slate-800/80 p-3.5 rounded-2xl flex items-center justify-between border border-blue-500/20 shadow-inner">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-400/30 flex items-center justify-center text-blue-400 font-bold text-lg">
                👤
              </div>
              <div>
                <p className="text-[9px] text-blue-300/80 font-bold uppercase tracking-wider">Pengguna Terhubung</p>
                <p className="font-mono font-bold text-sm text-white">{customerPhone}</p>
              </div>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>
        </div>

        {/* MODAL CUCIAN SELESAI */}
        {showFinishedModal && finishedOrderData && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-blue-500/30 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
              <div className="w-16 h-16 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-3xl mx-auto border border-blue-500/30">
                🎉
              </div>
              <div>
                <h3 className="text-lg font-black text-white">Cucian Anda Selesai!</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Resi <b className="text-blue-300 font-mono">{finishedOrderData.receipt_number}</b> di outlet <b>{finishedOrderData.outlets?.name}</b> telah siap diantar/diambil.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() => {
                    setShowFinishedModal(false);
                    setActiveTab('pickup');
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-2xl text-xs shadow-lg shadow-blue-900/40"
                >
                  🛵 ANTAR KE RUMAH
                </button>
                <button
                  onClick={() => setShowFinishedModal(false)}
                  className="w-full bg-slate-800 text-slate-300 font-semibold py-2.5 rounded-2xl text-xs"
                >
                  🏃 Saya Ambil Sendiri
                </button>
              </div>
            </div>
          </div>
        )}

        {msg && (
          <div className="mx-4 mt-2 p-3 bg-blue-950/60 border border-blue-500/30 rounded-2xl text-xs font-semibold text-blue-200 text-center flex justify-between items-center">
            <span>{msg}</span>
            <button onClick={() => setMsg('')} className="text-slate-400 hover:text-white text-sm font-bold">✕</button>
          </div>
        )}

        {/* CONTAINER CONTENT */}
        <div className="p-4 flex-1 space-y-5">

          {/* TAB 1: BERANDA */}
          {activeTab === 'home' && (
            <div className="space-y-5">
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-700 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-blue-400/20">
                <span className="bg-white/10 backdrop-blur-md border border-white/20 text-[9px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                  Briwash Express
                </span>
                <h2 className="text-xl font-black leading-tight mt-3">
                  Pakaian Bersih Tanpa Repot Datang ke Outlet
                </h2>
                <p className="text-xs text-blue-100/80 mt-1.5 leading-relaxed">
                  Tim kami akan menjemput, mencuci rapi, dan mengantarkan kembali ke lokasi Anda.
                </p>
                <button 
                  onClick={() => setActiveTab(addresses.length > 0 ? 'pickup' : 'address')} 
                  className="mt-4 bg-white text-blue-950 text-xs font-black px-6 py-3 rounded-2xl shadow-lg hover:bg-blue-50 transition active:scale-95 flex items-center gap-2"
                >
                  <span>🛵</span>
                  <span>PESAN JEMPUT SEKARANG</span>
                </button>
              </div>

              {activePickups.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-extrabold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                    <span>🛵</span> Penjemputan Berjalan
                  </h3>
                  {activePickups.map((pkp) => (
                    <div key={pkp.id} className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl space-y-3 backdrop-blur-md">
                      <div className="flex justify-between items-center border-b border-slate-700 pb-2.5">
                        <span className="font-mono font-bold text-xs text-blue-300">{pkp.order_number || 'ONLINE'}</span>
                        <span className="bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                          {pkp.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 space-y-1">
                        <p>📍 Cabang: <b className="text-white">{pkp.outlets?.name || 'POS Terdekat'}</b></p>
                        <p>🧺 Detail: <b className="text-white">{pkp.service_type}</b></p>
                        <p>🚚 Estimasi Ongkir: <b className="text-emerald-400">Rp {Number(pkp.delivery_fee || 0).toLocaleString('id-ID')}</b></p>
                      </div>
                      {(pkp.status === 'Menunggu Driver' || pkp.status === 'PENDING_ONLINE_POS') && (
                        <button onClick={() => handleCancelPickup(pkp.id)} disabled={isSubmitting} className="w-full mt-2 bg-slate-900 border border-rose-500/30 text-rose-400 text-xs font-bold py-2 rounded-xl hover:bg-rose-950/30 transition">
                          ❌ BATALKAN JEMPUTAN
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                    <span>📍</span> Live Tracking ({activeOrders.length})
                  </h3>
                  <span className="text-[9px] font-bold text-blue-300 bg-blue-950 border border-blue-800/50 px-2.5 py-0.5 rounded-full">
                    Auto-Sync
                  </span>
                </div>

                {activeOrders.map((order) => {
                  const currentStep = getTrackingStep(order.status);
                  return (
                    <div key={order.id} className="bg-slate-800/60 border border-slate-700/80 rounded-3xl p-4 space-y-3 backdrop-blur-md">
                      <div className="flex justify-between items-start border-b border-slate-700 pb-2.5">
                        <div>
                          <h4 className="font-bold text-white text-xs">{order.service_type}</h4>
                          <p className="text-[10px] font-mono text-slate-400 mt-0.5">{order.receipt_number} • {order.outlets?.name}</p>
                        </div>
                        <span className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[9px] font-black px-2.5 py-1 rounded-lg uppercase">
                          {order.status}
                        </span>
                      </div>

                      <div className="py-2 space-y-2">
                        <div className="flex justify-between text-[9px] font-bold text-slate-400">
                          <span className={currentStep >= 1 ? 'text-blue-400 font-bold' : ''}>1. Diterima</span>
                          <span className={currentStep >= 2 ? 'text-blue-400 font-bold' : ''}>2. Dicuci</span>
                          <span className={currentStep >= 3 ? 'text-blue-400 font-bold' : ''}>3. Setrika</span>
                          <span className={currentStep >= 4 ? 'text-emerald-400 font-bold' : ''}>4. Packing</span>
                        </div>
                        <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden flex border border-slate-700/50">
                          <div className={`h-full transition-all duration-500 ${currentStep >= 1 ? 'bg-blue-500' : 'bg-transparent'}`} style={{ width: '25%' }}></div>
                          <div className={`h-full transition-all duration-500 ${currentStep >= 2 ? 'bg-blue-500' : 'bg-transparent'}`} style={{ width: '25%' }}></div>
                          <div className={`h-full transition-all duration-500 ${currentStep >= 3 ? 'bg-blue-500' : 'bg-transparent'}`} style={{ width: '25%' }}></div>
                          <div className={`h-full transition-all duration-500 ${currentStep >= 4 ? 'bg-emerald-400' : 'bg-transparent'}`} style={{ width: '25%' }}></div>
                        </div>
                      </div>

                      <div className="text-[11px] space-y-1 text-slate-300 pt-2 border-t border-slate-700/80">
                        <div className="flex justify-between"><span>Berat Kasir:</span><b>{order.weight_kg > 0 ? `${order.weight_kg} Kg` : ''} {order.pcs_count > 0 ? `${order.pcs_count} Pcs` : ''}</b></div>
                        <div className="flex justify-between"><span>Total Tagihan:</span><b className="text-emerald-400 font-mono text-xs">Rp {Number(order.amount).toLocaleString('id-ID')}</b></div>
                      </div>
                    </div>
                  );
                })}

                {activeOrders.length === 0 && (
                  <div className="text-center py-10 bg-slate-800/40 rounded-3xl border border-slate-800 space-y-2">
                    <span className="text-4xl block opacity-60">🧺</span>
                    <p className="text-xs font-bold text-slate-300">Belum ada cucian aktif</p>
                    <p className="text-[11px] text-slate-500">Pesan penjemputan pertama Anda hari ini!</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: ALAMAT */}
          {activeTab === 'address' && (
            <div className="space-y-4">
              <div className="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 space-y-4 backdrop-blur-md">
                <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">
                    {editingAddressId ? '✏️ Edit Alamat' : '📍 Tambah Alamat Baru'}
                  </h3>
                  {editingAddressId && (
                    <button onClick={handleCancelEditAddress} className="text-xs font-bold text-rose-400 hover:underline">
                      Batal
                    </button>
                  )}
                </div>

                <form onSubmit={handleSaveAddress} className="space-y-3.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">Label Alamat</label>
                    <select value={labelName} onChange={(e) => setLabelName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-bold text-white focus:outline-none focus:border-blue-500">
                      <option value="Rumah">🏠 Rumah</option>
                      <option value="Kantor">🏢 Kantor</option>
                      <option value="Kos">🏫 Kos / Kontrakan</option>
                      <option value="Lainnya">📍 Lainnya</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">Alamat Lengkap</label>
                    <textarea value={fullAddress} onChange={(e) => setFullAddress(e.target.value)} placeholder="Nama Jalan, No. Rumah, Kota" rows={2} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" required />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">Patokan Driver</label>
                    <input type="text" value={patokan} onChange={(e) => setPatokan(e.target.value)} placeholder="Contoh: Pagar Biru Depan Samping Masjid" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                  </div>

                  <div className="bg-slate-900/90 border border-slate-700/80 p-3.5 rounded-2xl space-y-2.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-blue-300 text-xs">Koordinat GPS:</span>
                      <button type="button" onClick={handleDetectGPS} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-xl transition">
                        📡 DETEKSI GPS SAYA
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" step="any" value={lat !== null ? lat : ''} onChange={(e) => setLat(e.target.value ? Number(e.target.value) : null)} placeholder="Lat" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-300" required />
                      <input type="number" step="any" value={lon !== null ? lon : ''} onChange={(e) => setLon(e.target.value ? Number(e.target.value) : null)} placeholder="Lon" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-300" required />
                    </div>
                  </div>

                  <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl text-xs shadow-lg shadow-blue-900/30 transition active:scale-95">
                    {editingAddressId ? '💾 PERBARUI ALAMAT' : '➕ SIMPAN ALAMAT'}
                  </button>
                </form>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                  📋 Alamat Tersimpan ({addresses.length})
                </h3>
                {addresses.map((addr) => (
                  <div key={addr.id} className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-4 space-y-2 backdrop-blur-md">
                    <div className="flex justify-between items-start">
                      <span className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[10px] font-bold px-2.5 py-0.5 rounded-md">{addr.label_name}</span>
                      <div className="flex gap-2">
                        <button onClick={() => handleStartEditAddress(addr)} className="text-[10px] font-bold text-indigo-300 bg-indigo-950 border border-indigo-800/50 px-2.5 py-1 rounded-lg">✏️ Edit</button>
                        <button onClick={() => handleDeleteAddress(addr.id)} className="text-[10px] font-bold text-rose-400 bg-rose-950 border border-rose-800/50 px-2.5 py-1 rounded-lg">🗑️ Hapus</button>
                      </div>
                    </div>
                    <p className="text-xs font-bold text-white">{addr.full_address}</p>
                    {addr.patokan && <p className="text-[11px] text-slate-400 italic">Patokan: "{addr.patokan}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: FORM PICKUP ONLINE (MULTI-SERVICE + DETAIL CUCIAN) */}
          {activeTab === 'pickup' && (
            <div className="space-y-5">
              <div className="bg-slate-800/80 border border-slate-700/80 rounded-3xl p-5 shadow-xl backdrop-blur-md text-slate-100 font-sans">
                <h3 className="text-base font-bold text-center mb-1 text-cyan-400">Order Laundry Online POS</h3>
                <p className="text-[11px] text-center text-slate-400 mb-5">Pilih Kiloan dan/atau Satuan Sekaligus dalam 1 Order</p>

                <form onSubmit={handleSubmitPickup} className="space-y-4">
                  <div className="space-y-2.5">
                    <label className="text-[11px] text-slate-400 font-semibold">Pilih Alamat Penjemputan:</label>
                    <select
                      value={selectedAddressId}
                      onChange={(e) => setSelectedAddressId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-bold text-white"
                      required
                    >
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label_name} - {a.full_address.slice(0, 30)}...
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      placeholder="Nama Lengkap Pemesan"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* SEKSI 1: PAKET KILOAN (OPSIONAL VIA CHECKBOX) */}
                  <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-cyan-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useKiloan}
                        onChange={(e) => setUseKiloan(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 text-cyan-500 focus:ring-0"
                      />
                      <span>📦 TAMBAH PAKET LAUNDRY KILOAN</span>
                    </label>

                    {useKiloan && (
                      <div className="space-y-3 pt-1 border-t border-slate-800/80">
                        <select
                          value={kiloanPackage}
                          onChange={(e) => {
                            setKiloanPackage(e.target.value);
                            setKiloanPricePerKg(e.target.value.includes('Setrika') ? 5000 : 7000);
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                        >
                          <option value="Cuci Komplit (Rp 7.000/kg)">Cuci Komplit (Rp 7.000/kg)</option>
                          <option value="Cuci Lipat (Rp 5.500/kg)">Cuci Lipat (Rp 5.500/kg)</option>
                          <option value="Setrika Saja (Rp 5.000/kg)">Setrika Saja (Rp 5.000/kg)</option>
                        </select>

                        <div className="flex justify-between items-center text-xs text-slate-300">
                          <span>Estimasi Berat (Kg):</span>
                          <input
                            type="number"
                            min="1"
                            value={estimatedKg}
                            onChange={(e) => setEstimatedKg(Number(e.target.value))}
                            className="w-16 bg-slate-950 border border-slate-800 text-center rounded-lg p-1 text-xs font-bold text-cyan-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SEKSI 2: ITEM SATUAN (SEARCH & ADD) */}
                  <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 space-y-3">
                    <label className="text-xs font-bold text-cyan-400 block">
                      👔 TAMBAH ITEM LAUNDRY SATUAN
                    </label>
                    <input
                      type="text"
                      placeholder="🔍 Cari: Bedcover, Sprei, Jas, Sepatu, Karpet..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                    />

                    {searchQuery && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl max-h-40 overflow-y-auto divide-y divide-slate-800/80">
                        {filteredSatuan.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => addSatuanItem(item)}
                            className="p-2.5 text-xs flex justify-between cursor-pointer hover:bg-slate-800 transition"
                          >
                            <div>
                              <div className="font-semibold text-slate-200">{item.name}</div>
                              <div className="text-[10px] text-slate-400">Reguler: {item.estimateDays} Hari</div>
                            </div>
                            <span className="text-cyan-400 font-bold">+ Rp {item.price.toLocaleString()}/{item.unit}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Cart Item Satuan */}
                    {selectedSatuanItems.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Item Satuan Dipilih:</p>
                        {selectedSatuanItems.map(item => (
                          <div key={item.id} className="flex justify-between items-center text-xs bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                            <div>
                              <div className="font-medium text-slate-200">{item.name} (x{item.qty})</div>
                              <div className="text-[10px] text-slate-400">Rp {item.price.toLocaleString()} x {item.qty}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-cyan-400">Rp {(item.price * item.qty).toLocaleString()}</span>
                              <button
                                type="button"
                                onClick={() => removeSatuanItem(item.id)}
                                className="text-rose-400 font-bold px-1.5 py-0.5 hover:bg-rose-950/40 rounded"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* SEKSI 3: INFORMASI DETAIL KONDISI CUCIAN */}
                  <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 space-y-3">
                    <label className="text-xs font-bold text-cyan-400 block">
                      📋 INFORMASI DETAIL CUCIAN
                    </label>

                    {/* 1. Berapa Kantong */}
                    <div className="flex justify-between items-center text-xs text-slate-300">
                      <span>1. Jumlah Kantong:</span>
                      <select
                        value={bagCount}
                        onChange={(e) => setBagCount(Number(e.target.value))}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-cyan-400 font-bold"
                      >
                        <option value={1}>1 Kantong</option>
                        <option value={2}>2 Kantong</option>
                        <option value={3}>3 Kantong</option>
                        <option value={4}>4 Kantong</option>
                        <option value={5}>5+ Kantong</option>
                      </select>
                    </div>

                    {/* 2. Proses Cuci */}
                    <div className="flex justify-between items-center text-xs text-slate-300">
                      <span>2. Proses Cuci:</span>
                      <select
                        value={isSeparated ? 'pis' : 'gab'}
                        onChange={(e) => setIsSeparated(e.target.value === 'pis')}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-cyan-400 font-bold"
                      >
                        <option value="gab">Gabung Semua</option>
                        <option value="pis">Pisah Per Kantong</option>
                      </select>
                    </div>

                    {/* 3. Pakaian Luntur */}
                    <div className="flex justify-between items-center text-xs text-slate-300">
                      <span>3. Ada Pakaian Luntur?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHasFading(false)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition ${!hasFading ? 'bg-cyan-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}
                        >
                          Tidak
                        </button>
                        <button
                          type="button"
                          onClick={() => setHasFading(true)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition ${hasFading ? 'bg-rose-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}
                        >
                          Ya
                        </button>
                      </div>
                    </div>

                    {/* 4. Barang Berharga */}
                    <div className="flex justify-between items-center text-xs text-slate-300">
                      <span>4. Ada Barang Berharga?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHasValuables(false)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition ${!hasValuables ? 'bg-cyan-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}
                        >
                          Tidak
                        </button>
                        <button
                          type="button"
                          onClick={() => setHasValuables(true)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition ${hasValuables ? 'bg-amber-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}
                        >
                          Ya
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SEKSI 4: PILIHAN KECEPATAN */}
                  <div className="space-y-2">
                    <label className="text-[11px] text-slate-400 font-semibold">Pilih Layanan Kecepatan:</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(speedOptions) as Array<keyof typeof speedOptions>).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSpeed(key)}
                          className={`p-2.5 rounded-xl text-left border text-xs transition ${
                            speed === key ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300' : 'border-slate-800 bg-slate-900/40 text-slate-400'
                          }`}
                        >
                          <div className="font-bold">{speedOptions[key].label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ESTIMASI TOTAL RINGKASAN */}
                  <div className="bg-slate-900/90 border border-cyan-500/30 p-3.5 rounded-2xl space-y-2 text-xs">
                    <div className="flex justify-between text-slate-300">
                      <span>Estimasi Pengerjaan:</span>
                      <span className="font-bold text-yellow-400">{maxEstimateDays}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Subtotal Layanan:</span>
                      <span className="font-bold">Rp {totalEstimasiLayanan.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Ongkos Kirim PP ({estimatedDistanceKm} Km):</span>
                      <span className="font-bold text-cyan-400">Rp {estimatedFee.toLocaleString()}</span>
                    </div>
                    <div className="border-t border-slate-800 pt-2 flex justify-between text-sm font-bold text-cyan-400">
                      <span>Total Estimasi:</span>
                      <span>Rp {(totalEstimasiLayanan + estimatedFee).toLocaleString()}</span>
                    </div>

                    <label className="flex items-start gap-2 pt-2 text-[11px] text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreeOngkir}
                        onChange={(e) => setAgreeOngkir(e.target.checked)}
                        className="mt-0.5 rounded border-slate-700 text-cyan-500 focus:ring-0"
                      />
                      <span>Saya menyetujui estimasi pengerjaan dan ongkir yang divalidasi oleh driver/admin POS.</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow-lg transition duration-200"
                  >
                    {isSubmitting ? 'MEMPROSES ORDER...' : '🚀 SETUJU & KIRIM ORDER ONLINE'}
                  </button>
                </form>
              </div>
            </div>
          )}

        </div>

        {/* BOTTOM NAV BAR */}
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/90 border-t border-slate-800 backdrop-blur-xl flex justify-around p-3 z-50">
          <button 
            onClick={() => setActiveTab('home')} 
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 'home' ? 'text-blue-400 font-bold scale-105' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span className="text-xl">🏠</span>
            <span className="text-[10px] mt-1">Beranda</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('pickup')} 
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 'pickup' ? 'text-blue-400 font-bold scale-105' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span className="text-xl">🛵</span>
            <span className="text-[10px] mt-1">Jemput</span>
          </button>

          <button 
            onClick={() => setActiveTab('address')} 
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 'address' ? 'text-blue-400 font-bold scale-105' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span className="text-xl">📍</span>
            <span className="text-[10px] mt-1">Alamat</span>
          </button>

          <AIChatWidget customerPhone={customerPhone} />
        </div>

      </div>
    </div>
  );
}