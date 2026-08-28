'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function TrackingPage() {
  const [receiptNumber, setReceiptNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orderData, setOrderData] = useState<any>(null);
  const [workLogs, setWorkLogs] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptNumber) return;

    setIsLoading(true);
    setErrorMsg('');
    setOrderData(null);
    setWorkLogs([]);

    const formattedReceipt = receiptNumber.trim().toUpperCase();

    const { data, error } = await supabase
      .from('transactions')
      .select('*, outlets(name)')
      .eq('receipt_number', formattedReceipt)
      .single();

    if (error || !data) {
      setErrorMsg('❌ Resi tidak ditemukan. Pastikan nomor resi (TRX-XXXXXX) sudah benar.');
    } else {
      setOrderData(data);

      const { data: logsData } = await supabase
        .from('work_logs')
        .select('*')
        .eq('transaction_id', data.id)
        .order('created_at', { ascending: true });

      if (logsData) {
        setWorkLogs(logsData);
      }
    }
    
    setIsLoading(false);
  };

  const getStatusColor = (status: string) => {
    if (status === 'Diterima' || status === 'Sortir') return 'bg-slate-200 text-slate-700';
    if (status === 'Mencuci') return 'bg-cyan-100 text-cyan-700';
    if (status === 'Pengeringan' || status === 'Mengeringkan') return 'bg-amber-100 text-amber-700';
    if (status === 'Setrika') return 'bg-orange-100 text-orange-700';
    if (status === 'Packing') return 'bg-purple-100 text-purple-700';
    if (status === 'Siap Diambil') return 'bg-blue-600 text-white shadow-lg animate-pulse';
    if (status === 'Selesai') return 'bg-emerald-500 text-white';
    return 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mb-3 shadow-inner">
            <span className="text-3xl">🌿</span>
          </div>
          <h1 className="text-2xl font-black text-emerald-700 tracking-tight">Cek Status Cucian</h1>
          <p className="text-xs text-slate-500 mt-2 font-medium">Lacak proses pakaian Anda secara Real-Time</p>
        </div>

        <form onSubmit={handleTrack} className="bg-white border border-slate-200 p-2 rounded-2xl shadow-sm flex gap-2 mb-6">
          <input
            type="text"
            placeholder="Contoh: TRX-123456"
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
            className="flex-1 bg-transparent px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none uppercase placeholder:normal-case"
            required
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl text-sm transition disabled:opacity-50"
          >
            {isLoading ? 'Mencari...' : '🔍 Lacak'}
          </button>
        </form>

        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs text-center font-bold mb-6">
            {errorMsg}
          </div>
        )}

        {!orderData && !isLoading && (
          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden mt-8">
            <div className="relative z-10">
              <span className="bg-white/20 text-white text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest">Promo Spesial</span>
              <h3 className="text-xl font-black mt-3 leading-tight">Dapatkan Saldo Tambahan s/d Rp 100.000!</h3>
              <p className="text-xs font-medium mt-2 opacity-90">Bergabunglah menjadi Member Platinum kami sekarang juga dan nikmati diskon khusus setiap cucian.</p>
              <button className="mt-4 bg-white text-emerald-700 font-bold px-5 py-2.5 rounded-xl text-xs shadow-sm">Tanyakan ke Kasir Kami</button>
            </div>
            <div className="absolute -right-6 -bottom-6 text-9xl opacity-20">🎁</div>
          </div>
        )}

        {orderData && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xl space-y-6">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Milik Pelanggan</p>
                <h3 className="font-black text-lg text-slate-800">{orderData.customer_name}</h3>
                <p className="text-xs text-emerald-600 font-medium mt-0.5">{orderData.outlets?.name || 'Cabang Pusat'}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded-md border border-slate-200">{orderData.receipt_number}</span>
                <p className="text-[10px] text-slate-400 mt-2">{new Date(orderData.created_at).toLocaleDateString('id-ID')}</p>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-bold text-slate-700">{orderData.service_type}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{orderData.weight_kg > 0 ? `${orderData.weight_kg} Kg` : ''} {orderData.pcs_count > 0 ? `${orderData.pcs_count} Pcs` : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Status Pembayaran</p>
                <p className="text-sm font-black text-emerald-600">{orderData.payment_method === 'Cash' || orderData.payment_method === 'QRIS' || orderData.payment_method === 'Deposit Saldo' ? 'LUNAS ✅' : `Rp ${Number(orderData.amount).toLocaleString('id-ID')}`}</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-500 uppercase text-center mb-2">Status Terkini</p>
              <div className={`py-3 px-4 rounded-xl text-center font-black text-sm transition-all duration-300 ${getStatusColor(orderData.status)}`}>
                {orderData.status.toUpperCase()}
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-bold text-xs text-slate-800 mb-4 uppercase tracking-wider flex items-center gap-1.5">
                <span>⏱️</span> Riwayat Waktu Pengerjaan
              </h4>

              <div className="relative border-l-2 border-emerald-500 ml-3 space-y-4 pl-4 text-xs">
                <div className="relative">
                  <div className="absolute -left-[23px] top-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"></div>
                  <p className="font-bold text-slate-800">Cucian Diterima di Kasir</p>
                  <p className="text-[10px] text-slate-400 font-mono">{new Date(orderData.created_at).toLocaleString('id-ID')}</p>
                </div>

                {workLogs.map((log, idx) => (
                  <div key={idx} className="relative">
                    <div className="absolute -left-[23px] top-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"></div>
                    <p className="font-bold text-slate-800">{log.stage}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{new Date(log.created_at).toLocaleString('id-ID')}</p>
                    {log.employee_name && <p className="text-[9px] text-slate-400 italic">Petugas: {log.employee_name}</p>}
                  </div>
                ))}

                {orderData.status === 'Siap Diambil' && (
                  <div className="relative">
                    <div className="absolute -left-[23px] top-0.5 w-3.5 h-3.5 bg-blue-600 rounded-full border-2 border-white animate-ping"></div>
                    <p className="font-bold text-blue-700">Siap Diambil di Outlet</p>
                    <p className="text-[10px] text-blue-500 font-mono">Bisa diambil sekarang</p>
                  </div>
                )}
              </div>
            </div>

            {(orderData.status === 'Siap Diambil' || orderData.status === 'Selesai' || orderData.status === 'Packing') && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                <h4 className="font-black text-rose-700 text-xs flex items-center gap-1.5 mb-1">
                  <span>⚠️</span> PENTING! PERATURAN KOMPLAIN
                </h4>
                <p className="text-[10px] text-rose-800 leading-relaxed font-medium">
                  Setiap bentuk komplain (kerusakan/kehilangan) <b>WAJIB</b> melampirkan <b>Video Unboxing</b> pakaian dari kantong plastik secara utuh tanpa jeda.
                  <br/><br/>
                  Batas maksimal laporan komplain adalah <b>1x24 Jam</b> terhitung sejak cucian diserahkan/diambil.
                </p>
              </div>
            )}
          </div>
        )}
        
        <div className="text-center mt-12 opacity-50">
          <p className="text-[9px] font-bold">Powered by Laundry ERP System</p>
        </div>

      </div>
    </div>
  );
}