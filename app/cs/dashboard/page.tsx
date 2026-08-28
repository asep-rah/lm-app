'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import RoleTaskInbox from '@/components/RoleTaskInbox';
import KpiRoleMonitoring from '@/components/KpiRoleMonitoring';
import { getStaffSession } from '@/lib/staffSession';
import { insertChatMessage, threadKeyOf } from '@/lib/csChat';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function CSDashboard() {
  const [activeTab, setActiveTab] = useState<'confirmations' | 'pickups' | 'transactions'>('pickups');
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [searchQuery, setSearchSearchQuery] = useState('');

  const [pickups, setPickups] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignedDriverMap, setAssignedDriverMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  // State Live Chat CS & Link Tracking Kurir Pihak Ketiga
  const [activeChatOrder, setActiveChatOrder] = useState<any | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [inputCsChat, setInputCsChat] = useState<string>('');
  const [trackingUrlInput, setTrackingUrlInput] = useState<Record<string, string>>({});

  // Load Pesan Chat CS (Mendukung Order ID & Chat Berdasarkan No HP Customer)
  const loadCsChats = async (targetOrder: any) => {
    setActiveChatOrder(targetOrder);
    const orderId = typeof targetOrder === 'object' ? targetOrder?.id : null;
    const phone = typeof targetOrder === 'object' ? (targetOrder?.customer_phone || targetOrder?.phone) : targetOrder;

    let query = supabase.from('support_chats').select('*');

    if (phone && orderId) {
      query = query.or(`order_id.eq.${orderId},customer_phone.eq.${phone}`);
    } else if (phone) {
      query = query.eq('customer_phone', phone);
    } else if (orderId) {
      query = query.eq('order_id', orderId);
    } else {
      query = query.is('order_id', null);
    }

    const { data } = await query.order('created_at', { ascending: true });
    setChatMessages(data || []);
  };

  // Kirim Pesan CS ke Customer (Simpan Phone & Order ID)
  const handleSendCsChat = async () => {
    if (!inputCsChat.trim()) return;

    const phone = typeof activeChatOrder === 'object' ? activeChatOrder?.customer_phone : activeChatOrder;
    const orderId = typeof activeChatOrder === 'object' ? activeChatOrder?.id : null;
    const msgText = inputCsChat.trim();
    const agent = getStaffSession();
    const key = threadKeyOf({ customer_phone: phone, order_id: orderId });
    const { data: sess } = await supabase
      .from('support_chat_sessions')
      .select('is_claimed, assigned_to_agent_id, assigned_to_agent_name')
      .eq('thread_key', key)
      .maybeSingle();
    if (
      sess?.is_claimed &&
      sess.assigned_to_agent_id &&
      sess.assigned_to_agent_id !== agent.id &&
      sess.assigned_to_agent_name !== agent.name
    ) {
      alert(`Chat ini dipegang oleh ${sess.assigned_to_agent_name}. Balas dari Command Center setelah handover.`);
      return;
    }

    setInputCsChat('');
    setChatMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        order_id: orderId || null,
        customer_phone: phone || null,
        sender_type: 'cs',
        message: msgText,
        created_at: new Date().toISOString()
      }
    ]);

    const { error } = await insertChatMessage({
      order_id: orderId || null,
      customer_phone: phone || null,
      sender_type: 'cs',
      message: msgText,
      sender_name: agent.name,
      assigned_to_agent_id: agent.id,
      assigned_to_agent_name: agent.name,
      is_claimed: true
    });

    if (error) {
      console.error('Error kirim CS chat:', error.message);
      alert(`⚠️ Gagal mengirim balasan CS: ${error.message}`);
    } else {
      loadCsChats(activeChatOrder);
    }
  };

  // Simpan Link Live Tracking Pihak Ketiga
  const handleSaveTrackingUrl = async (orderId: string) => {
    const url = trackingUrlInput[orderId];
    if (!url || !url.trim()) return alert('Masukkan URL Tracking terlebih dahulu!');

    const { error } = await supabase
      .from('pickup_orders')
      .update({ 
        third_party_tracking_url: url.trim(),
        status: 'Driver Menuju Lokasi'
      })
      .eq('id', orderId);

    if (!error) {
      alert('✅ Link Live Tracking berhasil dikirim ke customer!');
      loadCSData();
    } else {
      alert('❌ Gagal menyimpan URL tracking: ' + error.message);
    }
  };

  // Load Data Master, Transaksi & Driver
  const loadCSData = async () => {
    setIsLoading(true);

    const { data: outletData } = await supabase.from('outlets').select('*');
    if (outletData) setOutlets(outletData);

    const { data: driverData } = await supabase.from('employees').select('*').eq('role', 'driver');
    if (driverData) setDrivers(driverData);

    let pkpQuery = supabase
      .from('pickup_orders')
      .select('*, outlets(name), customer_addresses(*)')
      .order('created_at', { ascending: false });

    if (selectedOutlet !== 'ALL') {
      pkpQuery = pkpQuery.eq('outlet_id', selectedOutlet);
    }
    const { data: pkpData } = await pkpQuery;
    if (pkpData) setPickups(pkpData);

    let txQuery = supabase
      .from('transactions')
      .select('*, outlets(name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (selectedOutlet !== 'ALL') {
      txQuery = txQuery.eq('outlet_id', selectedOutlet);
    }
    const { data: txData } = await txQuery;
    if (txData) setTransactions(txData);

    let confQuery = supabase
      .from('transactions')
      .select('*, outlets(name)')
      .eq('status', 'Menunggu Konfirmasi Customer')
      .order('created_at', { ascending: false });

    if (selectedOutlet !== 'ALL') {
      confQuery = confQuery.eq('outlet_id', selectedOutlet);
    }
    const { data: confData } = await confQuery;
    if (confData) setPendingConfirmations(confData);

    setIsLoading(false);
  };

  useEffect(() => {
    loadCSData();
    const interval = setInterval(loadCSData, 10000);
    return () => clearInterval(interval);
  }, [selectedOutlet]);

  const handleAssignDriver = async (pickupId: string) => {
    const driverName = assignedDriverMap[pickupId];
    if (!driverName) return alert('⚠️ Pilih driver terlebih dahulu dari daftar!');

    const { error } = await supabase.from('pickup_orders').update({
      driver_name: driverName,
      status: 'Driver Menuju Lokasi'
    }).eq('id', pickupId);

    if (!error) {
      alert(`✅ Berhasil! Driver (${driverName}) ditugaskan ke lokasi customer.`);
      loadCSData();
    } else {
      alert('❌ Gagal menugaskan driver: ' + error.message);
    }
  };

  const openWhatsApp = (phone: string, textMessage: string) => {
    if (!phone) return alert('⚠️ Nomor WhatsApp pelanggan tidak ditemukan!');
    let cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    const encodedText = encodeURIComponent(textMessage);
    window.open(`https://wa.me/${cleanPhone}?text=${encodedText}`, '_blank');
  };

  const handleSendPickupConfirm = (p: any) => {
    const driverInfo = p.driver_name ? ` Driver kami (*${p.driver_name}*) sedang menuju lokasi Anda.` : ' Driver kami akan segera menuju lokasi Anda.';
    const msg = `Halo Kak! CS Laundrivery di sini 😊\n\nKami telah menerima pesanan penjemputan cucian Anda (*${p.order_number || 'PKP'}*) untuk lokasi: *${p.customer_addresses?.full_address || 'Alamat Tersimpan'}*.${driverInfo}\n\nMohon siapkan cuciannya ya Kak. Terima kasih! 🙏`;
    openWhatsApp(p.customer_phone, msg);
  };

  const handleSendBillConfirm = (t: any) => {
    const msg = `Halo Kak ${t.customer_name}! CS Laundrivery di sini 😊\n\nCucian Anda di cabang *${t.outlets?.name}* dengan Resi *${t.receipt_number}* telah selesai ditimbang dan divalidasi.\n\n*Rincian Tagihan:*\n• Layanan: ${t.service_type}\n• Berat/Jml: ${t.weight_kg > 0 ? t.weight_kg + ' Kg' : ''} ${t.pcs_count > 0 ? t.pcs_count + ' Pcs' : ''}\n• Total Tagihan: *Rp ${Number(t.amount).toLocaleString('id-ID')}*\n\nSilakan cek status dan selesaikan pembayaran melalui aplikasi: https://lm-coral.vercel.app/customer/dashboard\n\nTerima kasih! 🙏`;
    openWhatsApp(t.customer_phone || t.receipt_number, msg);
  };

  const handleSendFinishNotice = (t: any) => {
    const msg = `Halo Kak ${t.customer_name}! 🎉\n\nKabar gembira, cucian Anda (*Resi ${t.receipt_number}*) di cabang *${t.outlets?.name}* SUDAH SELESAI, bersih, wangi, dan rapi!\n\nApakah cucian ingin diambil sendiri ke toko atau mau dibantu *Pesan Driver Antar ke Rumah* via aplikasi? 😊\n\nKlik di sini: https://lm-coral.vercel.app/customer/dashboard`;
    openWhatsApp(t.customer_phone, msg);
  };

  const handleSendConfirmationWA = (t: any) => {
    const msg = `Halo Kak *${t.customer_name}*! CS Laundrivery di sini 😊\n\nCucian Kakak di cabang *${t.outlets?.name || 'Toko'}* dengan Resi *${t.receipt_number}* telah selesai ditimbang ulang oleh Kasir.\n\n*Rincian Hasil Timbangan Baru:*\n• Layanan: ${t.service_type}\n• Rincian: ${t.weight_kg > 0 ? t.weight_kg + ' Kg' : ''} ${t.pcs_count > 0 ? t.pcs_count + ' Pcs' : ''}\n• Total Tagihan Final: *Rp ${Number(t.amount).toLocaleString('id-ID')}*\n• Catatan: ${t.notes || '-'}\n\nMohon cek & konfirmasi rincian ini melalui aplikasi: https://lm-coral.vercel.app/customer/dashboard\n\nJika ada pertanyaan, silakan balas pesan ini ya Kak! Terima kasih! 🙏`;
    openWhatsApp(t.customer_phone || '', msg);
  };

  const handleApproveByCS = async (txId: string) => {
    if (!confirm('Setujui transaksi ini atas nama customer setelah konfirmasi via WA?')) return;

    // Tabel `transactions` hanya menyimpan tahapan pengerjaan di kolom `status`.
    // Mengirim kolom lain (mis. confirmation_status / updated_at) membuat Postgres
    // menolak seluruh update, sehingga persetujuan gagal tanpa pesan apa pun.
    // Mengembalikan status ke 'Sortir' sudah cukup untuk mengaktifkan lagi tombol
    // pengerjaan kasir di POS, karena status 'Menunggu Konfirmasi Customer'
    // menonaktifkan tombol tersebut.
    const { error } = await supabase
      .from('transactions')
      .update({ status: 'Sortir' })
      .eq('id', txId);

    if (error) {
      console.error('Gagal menyetujui transaksi:', error);
      alert('❌ Gagal menyetujui transaksi: ' + (error.message || 'Koneksi bermasalah'));
      return;
    }

    alert('✅ Transaksi disetujui! Kasir dapat melanjutkan pengerjaan.');
    loadCSData();
  };

  const filteredConfirmations = pendingConfirmations.filter(
    (t) =>
      t.receipt_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.customer_phone?.includes(searchQuery)
  );

  const filteredPickups = pickups.filter(
    (p) =>
      p.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.customer_phone?.includes(searchQuery)
  );

  const filteredTransactions = transactions.filter(
    (t) =>
      t.receipt_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER CS */}
        <div className="bg-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-4 border-blue-600">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-3">
              <span>🎧 Dashboard Customer Service</span>
              <span className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full font-bold uppercase">CS Pusat</span>
            </h1>
            <p className="text-blue-200 mt-1 text-xs md:text-sm">Pintu Utama Komunikasi, Instruksi Driver, Konfirmasi Tagihan, & Follow-up</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/cs" className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-sm transition">
              Command Center
            </Link>
            <Link href="/admin/pickups" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-md transition">
              🛵 Monitor Penjemputan
            </Link>
            <button onClick={loadCSData} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-4 rounded-xl transition text-xs shadow-md">
              🔄 REFRESH
            </button>
            <button
              onClick={async () => {
                const { data } = await supabase
                  .from('support_chats')
                  .select('customer_phone')
                  .not('customer_phone', 'is', null)
                  .order('created_at', { ascending: false })
                  .limit(1);

                if (data && data.length > 0) {
                  window.location.href = '/cs';
                } else {
                  alert('Belum ada chat umum masuk.');
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-md transition"
            >
              💬 Chat CS Masuk
            </button>
          </div>
        </div>

        <KpiRoleMonitoring />
        <RoleTaskInbox role="cs" />

        {/* FILTER BAR */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-3 justify-between items-center">
          <div className="flex bg-slate-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
            <button
              onClick={() => setActiveTab('pickups')}
              className={`flex-1 md:flex-none px-4 py-2.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'pickups' ? 'bg-blue-900 text-white shadow' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              🛵 Order Jemputan ({pickups.length})
            </button>
            <button
              onClick={() => setActiveTab('confirmations')}
              className={`flex-1 md:flex-none px-4 py-2.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'confirmations' ? 'bg-amber-600 text-white shadow' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              ⚠️ Perlu Konfirmasi ({pendingConfirmations.length})
            </button>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`flex-1 md:flex-none px-4 py-2.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'transactions' ? 'bg-blue-900 text-white shadow' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              🧺 Transaksi POS ({transactions.length})
            </button>
          </div>

          <div className="flex gap-2 w-full md:w-auto">
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-700"
            >
              <option value="ALL">🌐 Semua Cabang Outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  📍 {o.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="🔍 Cari No WA / Resi / Nama..."
              value={searchQuery}
              onChange={(e) => setSearchSearchQuery(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 w-full md:w-64"
            />
          </div>
        </div>

        {isLoading && <p className="text-center font-bold text-slate-500 animate-pulse">Memuat data CS...</p>}

        {/* TAB 1: ORDER PICKUP */}
        {activeTab === 'pickups' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">
                📋 Antrean Order Penjemputan Driver
              </h2>
              <span className="text-xs font-bold text-indigo-600">Total {filteredPickups.length} Orderan</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPickups.map((p) => {
                const isNewOrder =
                  p.status === 'Menunggu Driver' ||
                  p.status === 'Baru Masuk' ||
                  p.status === 'Menunggu Kurir' ||
                  p.status === 'Pickup Request';

                return (
                  <div key={p.id} className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition space-y-3 ${isNewOrder ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'}`}>
                    <div className="flex justify-between items-start border-b pb-2">
                      <div>
                        <span className="font-mono font-bold text-xs text-blue-900">{p.order_number || 'PKP'}</span>
                        <p className="text-[10px] text-slate-400">{new Date(p.created_at).toLocaleString('id-ID')}</p>
                      </div>
                      <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase ${isNewOrder ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-blue-100 text-blue-900'}`}>
                        {p.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-black text-slate-900 text-base">{p.customer_phone}</h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        📍 <b>{p.customer_addresses?.label_name || 'Alamat'}:</b> {p.customer_addresses?.full_address || 'Alamat tersimpan'}
                      </p>
                      <p className="text-[10px] text-blue-800 font-bold mt-1">Outlet: {p.outlets?.name || 'Mencari Outlet...'}</p>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-xl text-[10px] space-y-1 text-slate-700">
                      <p>Layanan: <b>{p.service_type}</b></p>
                      <p>Estimasi: <b>{p.estimated_weight} Kg</b> ({p.bag_count} Kantong)</p>
                      <p>Ongkir PP: <b>Rp {Number(p.delivery_fee || 0).toLocaleString('id-ID')}</b></p>
                    </div>
{/* DOKUMENTASI FOTO REAL-TIME DRIVER UNTUK CS */}
<div className="p-2.5 bg-slate-100/80 rounded-xl border border-slate-200 mt-2 space-y-2">
  <p className="text-[10px] font-extrabold text-slate-700 flex items-center gap-1">
    📸 Foto Bukti Driver
  </p>
  <div className="grid grid-cols-2 gap-2">
    <div>
      <span className="text-[9px] font-bold text-slate-500 block mb-0.5">1. Di Rumah Customer</span>
      {(p.photo_pickup_url || p.pickup_photo) ? (
        <a href={p.photo_pickup_url || p.pickup_photo} target="_blank" rel="noreferrer">
          <img 
            src={p.photo_pickup_url || p.pickup_photo} 
            className="w-full h-20 object-cover rounded-lg border border-slate-300 hover:opacity-90 transition-opacity" 
            alt="Foto Ambil"
          />
        </a>
      ) : (
        <div className="h-20 bg-slate-200/60 rounded-lg flex items-center justify-center text-[9px] text-slate-400 italic">Belum Ada</div>
      )}
    </div>
    <div>
      <span className="text-[9px] font-bold text-slate-500 block mb-0.5">2. Sampai Outlet</span>
      {(p.photo_outlet_url || p.outlet_photo) ? (
        <a href={p.photo_outlet_url || p.outlet_photo} target="_blank" rel="noreferrer">
          <img 
            src={p.photo_outlet_url || p.outlet_photo} 
            className="w-full h-20 object-cover rounded-lg border border-slate-300 hover:opacity-90 transition-opacity" 
            alt="Foto Outlet"
          />
        </a>
      ) : (
        <div className="h-20 bg-slate-200/60 rounded-lg flex items-center justify-center text-[9px] text-slate-400 italic">Belum Ada</div>
      )}
    </div>
  </div>
</div>
                    <div className="bg-indigo-50/70 border border-indigo-200 p-3 rounded-2xl space-y-2">
                      <label className="text-[10px] font-black text-indigo-900 block uppercase">
                        👔 Instruksi CS: Tugaskan Driver
                      </label>
                      <div className="flex gap-1.5">
                        <select
                          value={assignedDriverMap[p.id] || ''}
                          onChange={(e) => setAssignedDriverMap({ ...assignedDriverMap, [p.id]: e.target.value })}
                          className="w-full bg-white border border-indigo-300 rounded-xl p-2 text-xs font-bold text-slate-800"
                        >
                          <option value="">-- Pilih Driver --</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.name}>
                              🛵 {d.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssignDriver(p.id)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow transition whitespace-nowrap"
                        >
                          Utus
                        </button>
                      </div>
                      {p.driver_name && (
                        <p className="text-[10px] text-emerald-700 font-bold mt-1">
                          ✅ Driver Ditugaskan: {p.driver_name}
                        </p>
                      )}
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-xl space-y-2 border border-slate-200">
                      <div className="flex items-center justify-between">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                          p.courier_type === 'THIRD_PARTY'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-cyan-100 text-cyan-800 border border-cyan-300'
                        }`}>
                          {p.courier_type === 'THIRD_PARTY' ? '📦 Kurir Pihak Ketiga' : '🛵 Driver Internal'}
                        </span>

                        <button
                          type="button"
                          onClick={() => loadCsChats(p)}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow transition"
                        >
                          <span>💬</span>
                          <span>Chat CS Live</span>
                        </button>
                      </div>

                      {p.courier_type === 'THIRD_PARTY' && (
                        <div className="mt-2 bg-amber-50/80 border border-amber-200 p-2 rounded-lg space-y-1">
                          <label className="text-[9px] font-bold text-amber-900 block">Link Live Track (Grab/Gojek):</label>
                          {p.third_party_tracking_url ? (
                            <a
                              href={p.third_party_tracking_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-blue-600 underline font-semibold truncate block"
                            >
                              {p.third_party_tracking_url}
                            </a>
                          ) : (
                            <div className="flex gap-1">
                              <input
                                type="url"
                                placeholder="https://..."
                                value={trackingUrlInput[p.id] || ''}
                                onChange={(e) => setTrackingUrlInput({ ...trackingUrlInput, [p.id]: e.target.value })}
                                className="flex-1 text-[10px] bg-white border border-amber-300 rounded-lg p-1 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveTrackingUrl(p.id)}
                                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-[9px] px-2 py-1 rounded-lg"
                              >
                                Kirim
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSendPickupConfirm(p)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow flex items-center justify-center gap-1 mt-2"
                    >
                      <span>💬</span>
                      <span>Chat WA Konfirmasi Jemput</span>
                    </button>
                  </div>
                );
              })}
              {filteredPickups.length === 0 && (
                <p className="text-xs text-slate-400 col-span-full text-center py-8">
                  Tidak ada order penjemputan.
                </p>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: PERLU KONFIRMASI */}
        {activeTab === 'confirmations' && (
          <div className="space-y-4">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">
              ⚠️ Transaksi Perlu Konfirmasi Customer (Selisih Timbangan / Item)
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredConfirmations.map((t) => (
                <div key={t.id} className="bg-white border-2 border-amber-300 rounded-2xl p-4 shadow-sm hover:shadow-md transition space-y-3">
                  <div className="flex justify-between items-start border-b pb-2">
                    <div>
                      <span className="font-mono font-bold text-xs text-amber-900">{t.receipt_number}</span>
                      <p className="text-[10px] text-slate-400">{new Date(t.created_at).toLocaleString('id-ID')}</p>
                    </div>
                    <span className="bg-amber-100 text-amber-900 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                      Menunggu Konfirmasi
                    </span>
                  </div>

                  <div>
                    <h3 className="font-black text-slate-900 text-base">{t.customer_name}</h3>
                    <p className="text-xs text-slate-600 font-mono">No. WA: {t.customer_phone || '-'}</p>
                    <p className="text-[10px] text-blue-800 font-bold mt-1">Outlet: {t.outlets?.name || 'Cabang'}</p>
                  </div>

                  <div className="bg-amber-50/70 border border-amber-200 p-2.5 rounded-xl text-[11px] space-y-1 text-amber-950">
                    <p>Layanan: <b>{t.service_type}</b></p>
                    <p>Timbangan Baru: <b>{t.weight_kg > 0 ? t.weight_kg + ' Kg' : ''} {t.pcs_count > 0 ? t.pcs_count + ' Pcs' : ''}</b></p>
                    <p>Total Tagihan: <b className="text-emerald-700">Rp {Number(t.amount).toLocaleString('id-ID')}</b></p>
                    <p className="italic text-[10px] text-slate-600">Note: "{t.notes || '-'}"</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleSendConfirmationWA(t)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow flex items-center justify-center gap-2 transition"
                    >
                      <span>💬 Chat WA Konfirmasi Ke Customer</span>
                    </button>
                    <button
                      onClick={() => handleApproveByCS(t.id)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-xl text-xs shadow transition"
                    >
                      ✅ Setujui (Lanjut Cuci)
                    </button>
                  </div>
                </div>
              ))}

              {filteredConfirmations.length === 0 && (
                <p className="text-xs text-slate-400 col-span-full text-center py-8">🎉 Tidak ada transaksi yang memerlukan konfirmasi.</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: TRANSAKSI POS */}
        {activeTab === 'transactions' && (
          <div className="space-y-4">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">
              🧺 Transaksi Cucian POS (Semua Status)
            </h2>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-slate-900 text-white font-bold">
                    <tr>
                      <th className="p-3">Tgl & Resi</th>
                      <th className="p-3">Pelanggan</th>
                      <th className="p-3">Cabang Outlet</th>
                      <th className="p-3">Layanan & Berat</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Total Tagihan</th>
                      <th className="p-3 text-center">Aksi CS (1-Click WA)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTransactions.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="p-3">
                          <b className="font-mono text-blue-900">{t.receipt_number}</b>
                          <p className="text-[9px] text-slate-400">{new Date(t.created_at).toLocaleDateString('id-ID')}</p>
                        </td>
                        <td className="p-3 font-bold text-slate-800">{t.customer_name}</td>
                        <td className="p-3 font-semibold text-slate-600">{t.outlets?.name || 'Cabang'}</td>
                        <td className="p-3 text-slate-700">
                          {t.service_type}
                          <br />
                          <b className="text-[10px] text-blue-800">
                            {t.weight_kg > 0 ? `${t.weight_kg} Kg` : ''} {t.pcs_count > 0 ? `${t.pcs_count} Pcs` : ''}
                          </b>
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                              t.status === 'Selesai' || t.status === 'Siap Diambil'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-blue-100 text-blue-900'
                            }`}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="p-3 text-right font-black text-slate-900">
                          Rp {Number(t.amount).toLocaleString('id-ID')}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-center gap-1.5">
                            <button
                              onClick={() => handleSendBillConfirm(t)}
                              title="Kirim Rincian Tagihan Final"
                              className="bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-bold px-2.5 py-1 rounded-lg text-[10px] transition"
                            >
                              📲 Kirim Tagihan
                            </button>
                            {(t.status === 'Selesai' || t.status === 'Siap Diambil') && (
                              <button
                                onClick={() => handleSendFinishNotice(t)}
                                title="Kirim Notifikasi Cucian Selesai"
                                className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-bold px-2.5 py-1 rounded-lg text-[10px] transition"
                              >
                                🎉 Info Selesai
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MODAL LIVE CHAT CS DENGAN CUSTOMER */}
        {activeChatOrder && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-white border border-slate-200 w-full max-w-md rounded-2xl flex flex-col h-[500px] shadow-2xl overflow-hidden">
              <div className="p-3 bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">CS Live Chat</h3>
                  <p className="text-[10px] text-slate-300">
                    {activeChatOrder.customer_phone || activeChatOrder.phone || 'Customer'} ({activeChatOrder.order_number || 'Umum'})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveChatOrder(null)}
                  className="text-slate-400 hover:text-white font-bold text-sm px-2"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-slate-50">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-2.5 rounded-xl text-xs max-w-[80%] ${
                      msg.sender_type === 'cs'
                        ? 'bg-blue-600 text-white rounded-br-none ml-auto'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
                    }`}
                  >
                    <p>{msg.message}</p>
                    <span className="text-[9px] text-slate-400 mt-1 block text-right">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t bg-white flex gap-2">
                <input
                  type="text"
                  value={inputCsChat}
                  onChange={(e) => setInputCsChat(e.target.value)}
                  placeholder="Ketik pesan CS ke customer..."
                  className="flex-1 border border-slate-300 rounded-xl px-3 text-xs focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendCsChat}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-xs"
                >
                  Kirim
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
