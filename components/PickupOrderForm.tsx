'use client';

import React, { useState, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

// Database Layanan Satuan Reguler
const SATUAN_ITEMS = [
  { id: '1', name: 'Bedcover Double', price: 40000, estimateDays: 3, unit: 'pcs' },
  { id: '2', name: 'Bedcover Single', price: 25000, estimateDays: 3, unit: 'pcs' },
  { id: '3', name: 'Jaket / Hoodie', price: 30000, estimateDays: 3, unit: 'pcs' },
  { id: '4', name: 'Jas / Blazer', price: 30000, estimateDays: 3, unit: 'pcs' },
  { id: '5', name: 'Sepatu', price: 45000, estimateDays: 7, unit: 'pasang' },
  { id: '6', name: 'Karpet', price: 25000, estimateDays: 14, unit: 'm²' },
  { id: '7', name: 'Gordyn', price: 15000, estimateDays: 14, unit: 'm²' },
];

export default function PickupOrderForm() {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  
  const [category, setCategory] = useState<'KILOAN' | 'SATUAN' | ''>('');
  const [kiloanPackage, setKiloanPackage] = useState('Cuci Komplit (Rp 7.000/kg)');
  const [kiloanPricePerKg, setKiloanPricePerKg] = useState(7000);
  const [estimatedKg, setEstimatedKg] = useState<number>(3);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSatuanItems, setSelectedSatuanItems] = useState<{ id: string; name: string; price: number; qty: number; estimateDays: number; unit: string }[]>([]);

  // Opsi Kecepatan: Reguler (1x), One Day (+50% = 1.5x), Express (+100% = 2x), Quick (+200% = 3x)
  const [speed, setSpeed] = useState<'REGULER' | 'ONEDAY' | 'EXPRESS' | 'QUICK'>('REGULER');

  const speedOptions = {
    REGULER: { label: 'Reguler (Standar)', multiplier: 1.0 },
    ONEDAY: { label: 'One Day (+50%)', multiplier: 1.5 },
    EXPRESS: { label: 'Express (+100%)', multiplier: 2.0 },
    QUICK: { label: 'Quick (+200%)', multiplier: 3.0 },
  };

  const [agreeOngkir, setAgreeOngkir] = useState(true);
  const [loading, setLoading] = useState(false);

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

  // Subtotal dasar
  const subtotalBase = useMemo(() => {
    if (category === 'KILOAN') {
        return kiloanPricePerKg * Math.max(estimatedKg, 3);
    } else {
      return selectedSatuanItems.reduce((acc, curr) => acc + (curr.price * curr.qty), 0);
    }
  }, [category, kiloanPricePerKg, estimatedKg, selectedSatuanItems]);

  // Subtotal pengali kecepatan
  const totalEstimasiLayanan = Math.round(subtotalBase * speedOptions[speed].multiplier);

  // Logic estimasi pengerjaan di dalam komponen
  const maxEstimateDays = useMemo(() => {
    if (category === 'KILOAN') {
      return speed === 'QUICK' ? '3 Jam' : speed === 'EXPRESS' ? '6 Jam' : speed === 'ONEDAY' ? '24 Jam' : '3 Hari';
    }
    if (selectedSatuanItems.length === 0) return '-';
    
    const baseDays = Math.max(...selectedSatuanItems.map(i => i.estimateDays));

    if (speed === 'QUICK') return '3 Jam (Kilat)';
    if (speed === 'EXPRESS') return '6 Jam';
    if (speed === 'ONEDAY') return '24 Jam (1 Hari)';
    
    return `${baseDays} Hari`;
  }, [category, selectedSatuanItems, speed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreeOngkir) {
      alert('Mohon setujui persetujuan ongkos kirim.');
      return;
    }
    setLoading(true);

    try {
      const orderData = {
        order_type: 'ONLINE',
        customer_name: customerName,
        phone_number: phone,
        pickup_address: address,
        category: category,
        service_detail: category === 'KILOAN' 
          ? `${kiloanPackage} (~${estimatedKg} kg)`
          : JSON.stringify(selectedSatuanItems),
        speed_type: speed,
        estimated_completion: maxEstimateDays,
        estimated_subtotal: totalEstimasiLayanan,
        status: 'PENDING_ONLINE_POS',
        created_at: new Date().toISOString()
      };

      const { error } = await supabase.from('pickup_orders').insert([orderData]);

      if (error) throw error;

      alert('🚀 Order Online Berhasil Terkirim ke POS Order Online!');
      setCustomerName('');
      setPhone('');
      setAddress('');
      setSelectedSatuanItems([]);
    } catch (err: any) {
      alert('Gagal mengirim order: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full text-slate-100 font-sans">
      <h3 className="text-base font-bold text-center mb-1 text-cyan-400">Order Laundry Online POS</h3>
      <p className="text-[11px] text-center text-slate-400 mb-5">Penjemputan Terkoneksi ke POS Order Online</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2.5">
          <input
            type="text"
            placeholder="Nama Lengkap"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs focus:outline-none focus:border-cyan-500"
          />
          <input
            type="tel"
            placeholder="Nomor WhatsApp"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs focus:outline-none focus:border-cyan-500"
          />
          <textarea
            placeholder="Alamat Lengkap Penjemputan"
            required
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setCategory('KILOAN')}
            className={`py-2 text-xs font-bold rounded-lg transition ${category === 'KILOAN' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}
          >
            📦 LAUNDRY KILOAN
          </button>
          <button
            type="button"
            onClick={() => setCategory('SATUAN')}
            className={`py-2 text-xs font-bold rounded-lg transition ${category === 'SATUAN' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}
          >
            👔 LAUNDRY SATUAN
          </button>
        </div>

        {category === 'KILOAN' && (
          <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <label className="text-[11px] text-slate-400">Pilih Paket Kiloan</label>
            <select
              value={kiloanPackage}
              onChange={(e) => {
                setKiloanPackage(e.target.value);
                setKiloanPricePerKg(e.target.value.includes('Setrika') ? 5000 : 7000);
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white"
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
                className="w-16 bg-slate-900 border border-slate-700 text-center rounded-lg p-1 text-xs font-bold text-cyan-400"
              />
            </div>
          </div>
        )}

        {category === 'SATUAN' && (
          <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <label className="text-[11px] text-slate-400">Cari Item Satuan</label>
            <input
              type="text"
              placeholder="🔍 Cari: Bedcover, Jaket, Karpet, Gordyn..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white"
            />

            {searchQuery && (
              <div className="bg-slate-900 border border-slate-700 rounded-xl max-h-40 overflow-y-auto divide-y divide-slate-800">
                {filteredSatuan.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => addSatuanItem(item)}
                    className="p-2 text-xs flex justify-between cursor-pointer hover:bg-slate-800"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">{item.name}</div>
                      <div className="text-[10px] text-slate-400">Est. Reguler: {item.estimateDays} Hari</div>
                    </div>
                    <span className="text-cyan-400 font-bold">Rp {item.price.toLocaleString()}/{item.unit}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1">
              {selectedSatuanItems.map(item => (
                <div key={item.id} className="flex justify-between text-xs bg-slate-900 p-2 rounded-lg items-center border border-slate-800">
                  <div>
                    <div className="font-medium text-slate-200">{item.name} (x{item.qty})</div>
                    <div className="text-[10px] text-slate-400">Reguler: {item.estimateDays} Hari</div>
                  </div>
                  <span className="font-bold text-cyan-400">Rp {(item.price * item.qty).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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

        <div className="bg-slate-900/90 border border-cyan-500/30 p-3.5 rounded-2xl space-y-2 text-xs">
          <div className="flex justify-between text-slate-300">
            <span>Estimasi Waktu Pengerjaan:</span>
            <span className="font-bold text-yellow-400">{maxEstimateDays}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Subtotal Layanan:</span>
            <span className="font-bold">Rp {totalEstimasiLayanan.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Ongkos Kirim:</span>
            <span className="italic text-cyan-400">Divalidasi saat penjemputan</span>
          </div>
          <div className="border-t border-slate-800 pt-2 flex justify-between text-sm font-bold text-cyan-400">
            <span>Total Estimasi:</span>
            <span>Rp {totalEstimasiLayanan.toLocaleString()} + Ongkir</span>
          </div>

          <label className="flex items-start gap-2 pt-2 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeOngkir}
              onChange={(e) => setAgreeOngkir(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 text-cyan-500 focus:ring-0"
            />
            <span>Saya menyetujui estimasi pengerjaan dan ongkir yang divalidasi oleh driver/admin.</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs rounded-xl shadow-lg transition duration-200"
        >
          {loading ? 'MEMPROSES ORDER...' : '🚀 SETUJU & KIRIM ORDER ONLINE'}
        </button>
      </form>
    </div>
  );
}