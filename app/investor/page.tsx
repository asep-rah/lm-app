'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export default function InvestorDashboard() {
  const [investorName, setInvestorName] = useState('');
  const [allowedOutlets, setAllowedOutlets] = useState<string[]>([]);
  const [outletsMap, setOutletsMap] = useState<any>({});
  
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [period, setPeriod] = useState('THIS_MONTH');

  const [stats, setStats] = useState({ income: 0, expense: 0, profit: 0, trxCount: 0 });
  const [tableData, setTableData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const userStr = localStorage.getItem('laundry_user');
    if (!userStr) { window.location.href = '/login'; return; }
    const user = JSON.parse(userStr);
    
    if (user.role !== 'investor' && user.role !== 'owner') {
      alert('Akses khusus Investor!');
      window.location.href = '/login';
    }
    
    setInvestorName(user.name);
    // Jika owner, bisa lihat semua. Jika investor, baca array access_outlets dari JSONB
    let accessList: string[] = [];
    if (user.access_outlets) {
      try { accessList = typeof user.access_outlets === 'string' ? JSON.parse(user.access_outlets) : user.access_outlets; } catch (e) {}
    }
    setAllowedOutlets(accessList);
  }, []);

  useEffect(() => {
    async function fetchInvestorData() {
      if (allowedOutlets.length === 0) { setIsLoading(false); return; }
      setIsLoading(true);

      // Ambil nama cabang-cabang yang dimiliki investor ini
      const { data: outletData } = await supabase.from('outlets').select('id, name').in('id', allowedOutlets);
      const outMap: any = {};
      (outletData || []).forEach(o => outMap[o.id] = o.name);
      setOutletsMap(outMap);

      // Jika select cabang ALL, gunakan semua akses. Jika spesifik, gunakan yang dipilih
      const outletsToQuery = selectedOutlet === 'ALL' ? allowedOutlets : [selectedOutlet];

      let txQuery = supabase.from('transactions').select('created_at, amount, service_type, order_type, outlet_id').in('outlet_id', outletsToQuery);
      let memQuery = supabase.from('membership_logs').select('created_at, price, package_name, outlet_id').in('outlet_id', outletsToQuery);
      let expQuery = supabase.from('expenses').select('created_at, amount, category, description, outlet_id').in('outlet_id', outletsToQuery);

      const [{ data: txs }, { data: mems }, { data: exps }] = await Promise.all([txQuery, memQuery, expQuery]);

      const now = new Date();
      const checkPeriod = (item: any) => {
        if (period === 'ALL') return true;
        const d = new Date(item.created_at);
        if (period === 'THIS_MONTH') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (period === 'LAST_MONTH') {
          const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
          const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
          return d.getMonth() === lastMonth && d.getFullYear() === lastYear;
        }
        return true;
      };

      const periodTxs = (txs || []).filter(checkPeriod);
      const periodMems = (mems || []).filter(checkPeriod);
      const periodExps = (exps || []).filter(checkPeriod);

      let inc = 0; let exp = 0;
      let combinedData: any[] = [];

      periodTxs.forEach((t: any) => { 
        inc += Number(t.amount); 
        combinedData.push({ date: t.created_at, type: 'Pemasukan', category: 'Laundry', desc: t.service_type, amount: Number(t.amount), outlet: outMap[t.outlet_id] });
      });
      periodMems.forEach((m: any) => { 
        inc += Number(m.price);
        combinedData.push({ date: m.created_at, type: 'Pemasukan', category: 'Membership', desc: `Paket ${m.package_name}`, amount: Number(m.price), outlet: outMap[m.outlet_id] });
      });
      periodExps.forEach((e: any) => { 
        exp += Number(e.amount);
        combinedData.push({ date: e.created_at, type: 'Pengeluaran', category: e.category, desc: e.description, amount: -Number(e.amount), outlet: outMap[e.outlet_id] });
      });

      combinedData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      setStats({ income: inc, expense: exp, profit: inc - exp, trxCount: periodTxs.length + periodMems.length });
      setTableData(combinedData);
      setIsLoading(false);
    }
    fetchInvestorData();
  }, [allowedOutlets, selectedOutlet, period]);

  const handleLogout = () => { localStorage.removeItem('laundry_user'); window.location.href = '/login'; };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="bg-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black flex items-center gap-2">
              <span>Laporan Investor</span>
              <span className="bg-emerald-600 text-[10px] px-2.5 py-0.5 rounded-full uppercase">Read Only</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">Selamat datang, <b>{investorName}</b>. Berikut adalah pantauan cabang Anda.</p>
          </div>
          <button onClick={handleLogout} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2.5 px-6 rounded-xl text-xs transition shadow-sm">
            Keluar Sistem
          </button>
        </div>

        {allowedOutlets.length === 0 ? (
          <div className="bg-white p-8 rounded-3xl text-center shadow border border-slate-200">
            <span className="text-4xl block mb-2">🏢</span>
            <p className="font-bold text-slate-600">Akun Anda belum dihubungkan ke cabang manapun.</p>
            <p className="text-xs text-slate-400 mt-1">Silakan hubungi Owner untuk pengaturan akses cabang.</p>
          </div>
        ) : (
          <>
            {/* FILTER BAR */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-4 items-end">
              <div className="w-full md:w-1/2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">🏢 Pilih Cabang Investasi Anda</label>
                <select value={selectedOutlet} onChange={(e) => setSelectedOutlet(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-xs font-bold focus:border-emerald-500">
                  <option value="ALL">🌐 Semua Cabang Gabungan</option>
                  {allowedOutlets.map((id) => (<option key={id} value={id}>📍 {outletsMap[id]}</option>))}
                </select>
              </div>
              <div className="w-full md:w-1/2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">📅 Periode Laporan</label>
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-xs font-bold focus:border-emerald-500">
                  <option value="THIS_MONTH">Bulan Ini</option><option value="LAST_MONTH">Bulan Lalu</option><option value="ALL">Sepanjang Waktu (All Time)</option>
                </select>
              </div>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Total Pemasukan (Omset)</p>
                <h2 className="text-3xl font-black text-slate-900 mt-2">Rp {stats.income.toLocaleString('id-ID')}</h2>
                <p className="text-[10px] text-slate-500 mt-2 font-medium">Dari {stats.trxCount} Transaksi</p>
              </div>
              <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Total Pengeluaran (Opex)</p>
                <h2 className="text-3xl font-black text-rose-600 mt-2">Rp {stats.expense.toLocaleString('id-ID')}</h2>
                <p className="text-[10px] text-slate-500 mt-2 font-medium">Pembelian operasional cabang</p>
              </div>
              <div className={`p-6 rounded-3xl border shadow-sm ${stats.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                <p className={`text-[10px] font-extrabold uppercase tracking-wider ${stats.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Estimasi Net Profit</p>
                <h2 className={`text-3xl font-black mt-2 ${stats.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Rp {stats.profit.toLocaleString('id-ID')}</h2>
                <p className={`text-[10px] mt-2 font-bold ${stats.profit >= 0 ? 'text-emerald-600/70' : 'text-rose-600/70'}`}>Omset - Pengeluaran</p>
              </div>
            </div>

            {/* TRANSAKSI TABLE */}
            <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                <h3 className="font-bold text-slate-800 text-sm">📋 Daftar Transaksi & Kas</h3>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded font-bold">{tableData.length} Data</span>
              </div>
              {isLoading ? (
                <p className="text-center py-8 text-xs font-bold text-slate-400 animate-pulse">Menyiapkan laporan...</p>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold sticky top-0">
                      <tr><th className="p-4">Tgl & Waktu</th><th className="p-4">Cabang</th><th className="p-4">Kategori</th><th className="p-4">Deskripsi</th><th className="p-4 text-right">Nominal (Rp)</th></tr>
                    </thead>
                    <tbody>
                      {tableData.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="p-4 text-slate-500 font-mono text-[10px]">{new Date(row.date).toLocaleString('id-ID')}</td>
                          <td className="p-4 font-bold text-slate-700">{row.outlet}</td>
                          <td className="p-4"><span className={`px-2.5 py-1 rounded text-[9px] font-bold ${row.type === 'Pemasukan' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{row.category}</span></td>
                          <td className="p-4 text-slate-600">{row.desc}</td>
                          <td className={`p-4 text-right font-black ${row.type === 'Pemasukan' ? 'text-emerald-600' : 'text-rose-600'}`}>{row.type === 'Pemasukan' ? '+' : ''} Rp {Math.abs(row.amount).toLocaleString('id-ID')}</td>
                        </tr>
                      ))}
                      {tableData.length === 0 && (<tr><td colSpan={5} className="text-center py-8 text-slate-400 font-medium">Tidak ada transaksi pada periode ini.</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}