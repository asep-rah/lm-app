'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

const safeParse = (data: any, fallback: any) => {
  if (!data) return fallback;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch (e) { return fallback; }
};

const cleanPhone = (phoneStr: string) => {
  if (!phoneStr) return '';
  let cleaned = phoneStr.trim().replace(/\D/g, '');
  if (cleaned.startsWith('62')) cleaned = '0' + cleaned.slice(2);
  return cleaned;
};

export default function CustomerDashboardPage() {
  const [activeTab, setActiveTab] = useState<'home' | 'order' | 'deposit' | 'history' | 'profile'>('home');

  const [customerPhone, setCustomerPhone] = useState('');
  const [customerData, setCustomerData] = useState<any>(null);
  const [outletsList, setOutletsList] = useState<any[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState('');

  // DATA LAYANAN DINAMIS TERINTEGRASI POS (APP_SETTINGS)
  const [dynamicServices, setDynamicServices] = useState<any[]>([]);
  const [outletOverrides, setOutletOverrides] = useState<any>({});

  // STATE FORM ORDER LAUNDRY CUSTOMER
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  
  const [isKiloanChecked, setIsKiloanChecked] = useState(true);
  const [selectedKiloanSvc, setSelectedKiloanSvc] = useState('');
  const [kiloanEstKg, setKiloanEstKg] = useState('3');

  const [isSatuanChecked, setIsSatuanChecked] = useState(false);
  const [cartSatuan, setCartSatuan] = useState<Array<{ name: string; price: number; qty: number }>>([]);
  const [selectedSatuanSvc, setSelectedSatuanSvc] = useState('');
  const [inputSatuanQty, setInputSatuanQty] = useState('1');

  const [deliveryFee, setDeliveryFee] = useState(15000);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // RIWAYAT ORDER & MUTASI DEPOSIT
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [depositLogs, setDepositLogs] = useState<any[]>([]);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<any>(null);

  useEffect(() => {
    async function initPWA() {
      const { data: dbOutlets } = await supabase.from('outlets').select('*');
      if (dbOutlets && dbOutlets.length > 0) {
        setOutletsList(dbOutlets);
        setSelectedOutlet(dbOutlets[0].id);
      }

      const { data: dbSettings } = await supabase.from('app_settings').select('*').eq('id', 1).single();
      if (dbSettings) {
        const svcs = safeParse(dbSettings.dynamic_services, []);
        setDynamicServices(svcs);
        setOutletOverrides(safeParse(dbSettings.outlet_overrides, {}));

        const defaultKiloan = svcs.find((s: any) => s.type !== 'pcs') || svcs[0];
        const defaultSatuan = svcs.find((s: any) => s.type === 'pcs') || svcs[0];

        if (defaultKiloan) setSelectedKiloanSvc(defaultKiloan.name);
        if (defaultSatuan) setSelectedSatuanSvc(defaultSatuan.name);
      }

      const savedPhone = localStorage.getItem('laundry_customer_phone');
      if (savedPhone) {
        setCustomerPhone(savedPhone);
        fetchCustomerProfile(savedPhone);
      }
    }
    initPWA();
  }, []);

  const fetchCustomerProfile = async (phone: string) => {
    const norm = cleanPhone(phone);
    if (!norm) return;

    const { data: cust } = await supabase.from('customers').select('*').eq('phone', norm).limit(1);
    if (cust && cust.length > 0) {
      setCustomerData(cust[0]);
      if (cust[0].name) setCustomerName(cust[0].name);
      if (cust[0].address) setCustomerAddress(cust[0].address);
    }

    const { data: pickupOrders } = await supabase
      .from('pickup_orders')
      .select('*')
      .eq('phone_number', norm)
      .order('created_at', { ascending: false });

    const { data: posTransactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('customer_phone', norm)
      .order('created_at', { ascending: false });

    if (pickupOrders) {
      setActiveOrders(pickupOrders.filter(o => o.status !== 'Selesai' && o.status !== 'Batal'));
    }

    let historyArr: any[] = [];
    pickupOrders?.filter(o => o.status === 'Selesai' || o.status === 'Batal').forEach(o => {
      historyArr.push({ id: o.id, type: 'Online Order', title: o.service_type, detail: o.service_detail, price: o.estimated_price, date: o.created_at, status: o.status });
    });
    posTransactions?.forEach(t => {
      historyArr.push({ id: t.id, type: 'Outlet POS', title: `${t.service_type} (${t.receipt_number})`, detail: t.notes, price: t.amount, date: t.created_at, status: t.status });
    });

    historyArr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setCompletedOrders(historyArr);

    const { data: memLogs } = await supabase
      .from('membership_logs')
      .select('*')
      .eq('customer_phone', norm)
      .order('created_at', { ascending: false });

    if (memLogs) setDepositLogs(memLogs);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = cleanPhone(customerPhone);
    if (!norm) return alert('Ketik nomor WA aktif!');
    localStorage.setItem('laundry_customer_phone', norm);
    fetchCustomerProfile(norm);
  };

  const handleLogout = () => {
    localStorage.removeItem('laundry_customer_phone');
    setCustomerPhone('');
    setCustomerData(null);
  };

  const getServiceUnitPrice = (svcName: string) => {
    const activeSvc = dynamicServices.find(s => (s.name || '').trim().toLowerCase() === (svcName || '').trim().toLowerCase());
    if (activeSvc) {
      const localPrice = outletOverrides?.[selectedOutlet]?.[activeSvc.id]?.price;
      return localPrice !== undefined ? Number(localPrice) : Number(activeSvc.price || 0);
    }
    const lower = (svcName || '').toLowerCase();
    if (lower.includes('bedcover double')) return 35000;
    if (lower.includes('bedcover single')) return 25000;
    if (lower.includes('sprei')) return 15000;
    if (lower.includes('setrika')) return 5000;
    return 7000;
  };

  const handleAddSatuanToCart = () => {
    if (!selectedSatuanSvc) return;
    const price = getServiceUnitPrice(selectedSatuanSvc);
    const qty = Number(inputSatuanQty) || 1;

    setCartSatuan([...cartSatuan, { name: selectedSatuanSvc, price, qty }]);
    setInputSatuanQty('1');
  };

  const handleRemoveSatuan = (idx: number) => {
    setCartSatuan(cartSatuan.filter((_, i) => i !== idx));
  };

  const kiloanUnitPrice = getServiceUnitPrice(selectedKiloanSvc);
  const kiloanSubtotal = isKiloanChecked ? (Number(kiloanEstKg) || 1) * kiloanUnitPrice : 0;
  let satuanSubtotal = 0;
  if (isSatuanChecked) {
    cartSatuan.forEach(item => { satuanSubtotal += item.price * item.qty; });
  }

  const grandTotalEstimate = kiloanSubtotal + satuanSubtotal + deliveryFee;

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerPhone) return alert('Login terlebih dahulu!');
    if (!isKiloanChecked && (!isSatuanChecked || cartSatuan.length === 0)) {
      return alert('⚠️ Pilih minimal 1 paket Kiloan atau Satuan!');
    }

    setIsSubmitting(true);
    const normPhone = cleanPhone(customerPhone);

    const rincianArr: string[] = [];
    if (isKiloanChecked) {
      rincianArr.push(`${selectedKiloanSvc} (Est. ${kiloanEstKg} Kg)`);
    }
    if (isSatuanChecked && cartSatuan.length > 0) {
      const satuanItemsStr = cartSatuan.map(i => `${i.name} x${i.qty}`).join(', ');
      rincianArr.push(`Satuan: [${satuanItemsStr}]`);
    }

    const primaryServiceLabel = isKiloanChecked ? selectedKiloanSvc : `Satuan (${cartSatuan.length} Item)`;
    const serviceDetailLabel = rincianArr.join(' + ');

    const payload = {
      outlet_id: selectedOutlet,
      customer_name: customerName || 'Pelanggan Online',
      phone_number: normPhone,
      address: customerAddress || 'Penjemputan di Alamat Pelanggan',
      service_type: primaryServiceLabel,
      service_detail: serviceDetailLabel,
      estimated_weight: isKiloanChecked ? Number(kiloanEstKg) || 3 : 0,
      delivery_fee: deliveryFee,
      estimated_price: grandTotalEstimate,
      notes: notes,
      status: 'Menunggu Penjemputan'
    };

    const { error } = await supabase.from('pickup_orders').insert([payload]);

    if (!error) {
      alert('✅ PESANAN BERHASIL TERKIRIM KE KASIR POS!\nDriver/Kasir kami akan segera memproses penjemputan.');
      setCartSatuan([]);
      setNotes('');
      setActiveTab('home');
      fetchCustomerProfile(normPhone);
    } else {
      alert('❌ Gagal membuat pesanan: ' + error.message);
    }
    setIsSubmitting(false);
  };

  const kiloanServicesList = dynamicServices.filter(s => s.type !== 'pcs');
  const satuanServicesList = dynamicServices.filter(s => s.type === 'pcs');

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-6 pb-28 max-w-md mx-auto relative font-sans">
      
      {/* HEADER TOP BAR */}
      <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-200/80 flex justify-between items-center mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center font-black text-xl shadow-md shadow-blue-200">
            🧺
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 tracking-tight leading-none">Laundrivery</h1>
            <p className="text-[10px] text-blue-600 font-bold tracking-wide uppercase mt-0.5">Express Laundry Delivery</p>
          </div>
        </div>
        {customerData && (
          <button onClick={handleLogout} className="bg-rose-50 border border-rose-200 text-rose-600 text-[10px] font-bold px-3 py-1.5 rounded-xl hover:bg-rose-100 transition">
            Keluar
          </button>
        )}
      </div>

      {/* LOGIN FORM JIKA BELUM LOG IN */}
      {!customerData ? (
        <form onSubmit={handleLogin} className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-sm my-6">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto font-black shadow-inner">
            📲
          </div>
          <div className="text-center">
            <h3 className="text-base font-extrabold text-slate-900">Masuk Aplikasi</h3>
            <p className="text-xs text-slate-500 mt-1">Ketik Nomor WhatsApp Anda untuk melihat saldo deposit & status pesanan.</p>
          </div>
          <input
            type="tel"
            placeholder="Contoh: 08123456789"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
            required
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-blue-200 transition">
            Lanjutkan
          </button>
        </form>
      ) : (
        <>
          {/* TAB 1: HOME BERANDA */}
          {activeTab === 'home' && (
            <div className="space-y-4">
              
              {/* WALLET CARD */}
              <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 rounded-3xl p-5 text-white shadow-xl shadow-blue-200/50 space-y-4 relative overflow-hidden">
                <div className="flex justify-between items-start relative z-10">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-blue-200 block">Laundrivery Wallet</span>
                    <h2 className="text-lg font-extrabold text-white mt-0.5">{customerData.name || 'Pelanggan Setia'}</h2>
                    <p className="text-[11px] font-mono text-blue-100 opacity-90">{customerPhone}</p>
                  </div>
                  <span className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-extrabold uppercase border border-white/20">
                    VIP Member
                  </span>
                </div>

                <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 flex justify-between items-center relative z-10">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-blue-200 block">Saldo Deposit</span>
                    <span className="text-2xl font-black text-white">Rp {Number(customerData.deposit_balance || 0).toLocaleString('id-ID')}</span>
                  </div>
                  <button onClick={() => setActiveTab('deposit')} className="bg-white text-blue-700 px-4 py-2 rounded-xl text-xs font-extrabold shadow-md hover:bg-blue-50 transition">
                    + Top Up
                  </button>
                </div>
              </div>

              {/* ACTION BUTTON GRID */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setActiveTab('order')} className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center gap-3 hover:border-blue-500 transition shadow-sm text-left">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl font-black">
                    🛵
                  </div>
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 block">Pesan Express</span>
                    <span className="text-[10px] text-slate-500 font-medium">Jemput ke Rumah</span>
                  </div>
                </button>

                <button onClick={() => setActiveTab('deposit')} className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center gap-3 hover:border-indigo-500 transition shadow-sm text-left">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-2xl font-black">
                    💳
                  </div>
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 block">Paket Deposit</span>
                    <span className="text-[10px] text-slate-500 font-medium">Bonus Saldo Extra</span>
                  </div>
                </button>
              </div>

              {/* LIST ORDERAN AKTIF */}
              <div className="space-y-2.5 pt-1">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">⚡ Pesanan Dalam Proses ({activeOrders.length})</h3>
                  <button onClick={() => setActiveTab('history')} className="text-[11px] font-bold text-blue-600">Lihat Semua</button>
                </div>

                {activeOrders.map((order) => (
                  <div key={order.id} onClick={() => setSelectedOrderDetail(order)} className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-2.5 shadow-sm hover:border-blue-400 transition cursor-pointer">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-extrabold text-slate-900 text-sm">{order.service_type}</h4>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">{order.service_detail}</p>
                      </div>
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-extrabold px-3 py-1 rounded-full">
                        {order.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[10px]">
                      <span className="text-slate-400 font-medium">{new Date(order.created_at).toLocaleDateString('id-ID')}</span>
                      <span className="font-black text-blue-600 text-xs">Rp {Number(order.estimated_price).toLocaleString('id-ID')}</span>
                    </div>
                  </div>
                ))}

                {activeOrders.length === 0 && (
                  <div className="bg-white border border-slate-200/80 p-8 rounded-3xl text-center text-xs text-slate-400 shadow-sm">
                    Belum ada cucian yang sedang diproses.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: ORDER LAUNDRY FORM */}
          {activeTab === 'order' && (
            <form onSubmit={handleOrderSubmit} className="space-y-4">
              <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-sm">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-extrabold text-slate-900">Form Order Penjemputan</h3>
                  <p className="text-[11px] text-slate-500">Layanan Jemput-Antar Langsung ke Kasir POS</p>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Outlet Cabang Terdekat</label>
                  <select
                    value={selectedOutlet}
                    onChange={(e) => setSelectedOutlet(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-3.5 py-3 text-xs font-bold text-slate-800"
                  >
                    {outletsList.map((o) => (
                      <option key={o.id} value={o.id}>📍 {o.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Nama Lengkap Pemesan</label>
                  <input
                    type="text"
                    placeholder="Nama Anda"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3 text-xs font-semibold text-slate-800"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Alamat Penjemputan</label>
                  <textarea
                    placeholder="Jl. Supriyadi No. 123 (Samping Indomaret)"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3.5 text-xs text-slate-800 font-medium"
                    rows={2}
                    required
                  />
                </div>

                {/* SINKRONISASI PAKET KILOAN POS */}
                <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isKiloanChecked}
                      onChange={(e) => setIsKiloanChecked(e.target.checked)}
                      className="w-4 h-4 accent-blue-600 rounded"
                    />
                    <span className="text-xs font-extrabold text-blue-900">📦 Paket Laundry Kiloan</span>
                  </label>

                  {isKiloanChecked && (
                    <div className="space-y-2.5 pt-2 border-t border-blue-100">
                      <select
                        value={selectedKiloanSvc}
                        onChange={(e) => setSelectedKiloanSvc(e.target.value)}
                        className="w-full bg-white border border-blue-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                      >
                        {kiloanServicesList.map((svc, i) => (
                          <option key={i} value={svc.name}>
                            {svc.name} (Rp {getServiceUnitPrice(svc.name).toLocaleString('id-ID')}/Kg)
                          </option>
                        ))}
                      </select>

                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">Estimasi Berat (Kg)</label>
                        <input
                          type="number"
                          step="0.5"
                          value={kiloanEstKg}
                          onChange={(e) => setKiloanEstKg(e.target.value)}
                          className="w-full bg-white border border-blue-200 rounded-xl p-2.5 text-xs font-extrabold text-blue-700"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* SINKRONISASI PAKET SATUAN POS */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSatuanChecked}
                      onChange={(e) => setIsSatuanChecked(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <span className="text-xs font-extrabold text-slate-800">👔 Items Satuan (Bedcover/Sepatu/dll)</span>
                  </label>

                  {isSatuanChecked && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-200">
                      <select
                        value={selectedSatuanSvc}
                        onChange={(e) => setSelectedSatuanSvc(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                      >
                        {satuanServicesList.map((svc, i) => (
                          <option key={i} value={svc.name}>
                            {svc.name} (Rp {getServiceUnitPrice(svc.name).toLocaleString('id-ID')}/Pcs)
                          </option>
                        ))}
                        <option value="Bedcover Double">Bedcover Double (Rp 35.000/Pcs)</option>
                        <option value="Bedcover Single">Bedcover Single (Rp 25.000/Pcs)</option>
                        <option value="Sprei Single">Sprei Single (Rp 15.000/Pcs)</option>
                      </select>

                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Qty"
                          value={inputSatuanQty}
                          onChange={(e) => setInputSatuanQty(e.target.value)}
                          className="w-20 bg-white border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={handleAddSatuanToCart}
                          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
                        >
                          ➕ Tambah Item
                        </button>
                      </div>

                      {cartSatuan.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          {cartSatuan.map((item, idx) => (
                            <div key={idx} className="bg-white p-2.5 rounded-xl flex justify-between items-center text-xs border border-slate-200 shadow-sm">
                              <span className="font-semibold">{item.name} x{item.qty}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-blue-600">Rp {(item.price * item.qty).toLocaleString('id-ID')}</span>
                                <button type="button" onClick={() => handleRemoveSatuan(idx)} className="text-rose-500 font-bold px-1">✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Catatan Penjemputan (misal: Tolong ambil jam 2)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3.5 text-xs text-slate-800 font-medium"
                />

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-500 font-medium"><span>Subtotal Kiloan:</span><span>Rp {kiloanSubtotal.toLocaleString('id-ID')}</span></div>
                  <div className="flex justify-between text-slate-500 font-medium"><span>Subtotal Satuan:</span><span>Rp {satuanSubtotal.toLocaleString('id-ID')}</span></div>
                  <div className="flex justify-between text-slate-500 font-medium"><span>Ongkir Penjemputan:</span><span>Rp {deliveryFee.toLocaleString('id-ID')}</span></div>
                  <div className="flex justify-between font-black text-blue-600 text-sm border-t border-slate-200 pt-2.5 mt-1">
                    <span>ESTIMASI TOTAL:</span>
                    <span>Rp {grandTotalEstimate.toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-blue-200 transition"
                >
                  🚀 Pesan Penjemputan Sekarang
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: TOP UP DEPOSIT */}
          {activeTab === 'deposit' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 text-center shadow-sm">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl mx-auto font-black">
                  💳
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Top Up Saldo Deposit</h3>
                  <p className="text-xs text-slate-500 mt-1">Dapatkan bonus saldo ekstra & bayar cucian instan tanpa uang pas.</p>
                </div>

                <div className="grid grid-cols-1 gap-3 text-left">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs">Paket Silver</p>
                      <p className="text-[10px] text-slate-500 font-medium">Bayar Rp 300.000</p>
                    </div>
                    <span className="text-blue-600 font-black text-xs bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">+ Rp 320.000 Saldo</span>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-amber-200 flex justify-between items-center bg-amber-50/30">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs">Paket Gold</p>
                      <p className="text-[10px] text-slate-500 font-medium">Bayar Rp 500.000</p>
                    </div>
                    <span className="text-amber-700 font-black text-xs bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">+ Rp 550.000 Saldo</span>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-indigo-200 flex justify-between items-center bg-indigo-50/30">
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs">Paket Platinum</p>
                      <p className="text-[10px] text-slate-500 font-medium">Bayar Rp 900.000</p>
                    </div>
                    <span className="text-indigo-700 font-black text-xs bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-200">+ Rp 1.000.000 Saldo</span>
                  </div>
                </div>

                <a
                  href={`https://wa.me/6285172141494?text=Halo%20Kasir,%20saya%20pelanggan%20${customerData.name}%20(${customerPhone})%20ingin%20Top-Up%20Deposit%20Member.`}
                  target="_blank"
                  className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-2xl text-xs uppercase shadow-lg shadow-blue-200 transition"
                >
                  💬 Hubungi Kasir via WhatsApp
                </a>
              </div>

              {/* MUTASI SALDO */}
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">📜 Riwayat Top Up Saldo</h4>
                {depositLogs.map((log, i) => (
                  <div key={i} className="bg-white border border-slate-200 p-3.5 rounded-2xl text-xs flex justify-between items-center shadow-sm">
                    <div>
                      <p className="font-extrabold text-slate-900">Paket {log.package_name}</p>
                      <p className="text-[10px] text-slate-400 font-medium">{new Date(log.created_at).toLocaleDateString('id-ID')}</p>
                    </div>
                    <span className="font-black text-blue-600">+ Rp {Number(log.balance_added).toLocaleString('id-ID')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: RIWAYAT PESANAN */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">📜 Riwayat Pesanan Selesai</h3>
              {completedOrders.map((item) => (
                <div key={item.id} className="bg-white border border-slate-200 rounded-2xl p-4 text-xs space-y-2 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-extrabold text-slate-900 block">{item.title}</span>
                      <span className="text-[10px] text-slate-500 font-medium">{item.detail}</span>
                    </div>
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full">
                      {item.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[10px]">
                    <span className="text-slate-400 font-medium">{new Date(item.date).toLocaleDateString('id-ID')}</span>
                    <span className="font-black text-blue-600 text-xs">Rp {Number(item.price).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              ))}

              {completedOrders.length === 0 && (
                <div className="bg-white border border-slate-200 p-8 rounded-3xl text-center text-xs text-slate-400 shadow-sm">
                  Belum ada riwayat transaksi selesai.
                </div>
              )}
            </div>
          )}

          {/* TAB 5: PROFIL */}
          {activeTab === 'profile' && (
            <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-sm text-xs">
              <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2">👤 Profil Akun</h3>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Nama Lengkap</span>
                <p className="font-extrabold text-slate-900 text-sm mt-0.5">{customerData.name || '-'}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Nomor WhatsApp</span>
                <p className="font-mono text-blue-600 font-extrabold mt-0.5">{customerPhone}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-extrabold block">Alamat Penjemputan Utama</span>
                <p className="text-slate-700 font-medium mt-0.5">{customerData.address || 'Belum diatur'}</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* BOTTOM NAVIGATION BAR */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-slate-200 flex justify-around p-2.5 z-50 shadow-lg">
        <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center flex-1 ${activeTab === 'home' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">🏠</span>
          <span className="text-[9px] font-extrabold mt-0.5">Beranda</span>
        </button>
        <button onClick={() => setActiveTab('order')} className={`flex flex-col items-center flex-1 ${activeTab === 'order' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">🛵</span>
          <span className="text-[9px] font-extrabold mt-0.5">Order</span>
        </button>
        <button onClick={() => setActiveTab('deposit')} className={`flex flex-col items-center flex-1 ${activeTab === 'deposit' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">💳</span>
          <span className="text-[9px] font-extrabold mt-0.5">Deposit</span>
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center flex-1 ${activeTab === 'history' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">📜</span>
          <span className="text-[9px] font-extrabold mt-0.5">Riwayat</span>
        </button>
        <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center flex-1 ${activeTab === 'profile' ? 'text-blue-600' : 'text-slate-400'}`}>
          <span className="text-lg">👤</span>
          <span className="text-[9px] font-extrabold mt-0.5">Profil</span>
        </button>
      </div>

    </div>
  );
}