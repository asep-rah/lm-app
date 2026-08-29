'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { insertChatMessage, isStaffOnlyMessage } from '@/lib/csChat';
import { isVoidTransaction } from '@/lib/voidTx';
import { toast } from '@/lib/toast';

type LedgerRow = {
  date: string;
  type: 'Pemasukan' | 'Pengeluaran';
  category: string;
  desc: string;
  amount: number;
  outlet: string;
};

const inPeriod = (isoDate: string, period: string) => {
  if (period === 'ALL') return true;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  if (period === 'THIS_MONTH') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === 'LAST_MONTH') {
    const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    return d.getMonth() === lastMonth && d.getFullYear() === lastYear;
  }
  return true;
};

const investorOrderId = (user: { id?: string; username?: string }) =>
  `INV-${String(user.id || user.username || 'anon')}`;

export default function InvestorDashboard() {
  const [investorName, setInvestorName] = useState('');
  const [user, setUser] = useState<any>({});
  const [allowedOutlets, setAllowedOutlets] = useState<string[]>([]);
  const [outletsMap, setOutletsMap] = useState<Record<string, string>>({});
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [period, setPeriod] = useState('THIS_MONTH');
  const [stats, setStats] = useState({ income: 0, expense: 0, profit: 0, trxCount: 0, roi: 0 });
  const [outletRows, setOutletRows] = useState<{ id: string; name: string; income: number; expense: number; profit: number; roi: number; share: number }[]>([]);
  const [tableData, setTableData] = useState<LedgerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [queryText, setQueryText] = useState('');
  const [queries, setQueries] = useState<any[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const userStr = localStorage.getItem('laundry_user') || localStorage.getItem('laundry_owner_user');
    if (!userStr) {
      window.location.href = '/login';
      return;
    }
    const parsed = JSON.parse(userStr);
    const role = String(parsed.role || '').toLowerCase();
    if (role !== 'investor' && role !== 'owner') {
      alert('Akses khusus Investor!');
      window.location.href = '/login';
      return;
    }
    setInvestorName(parsed.name || 'Investor');
    setUser(parsed);

    (async () => {
      if (role === 'owner') {
        const { data } = await supabase.from('outlets').select('id');
        setAllowedOutlets((data || []).map((o: { id: string }) => o.id));
        return;
      }
      let accessList: string[] = [];
      if (parsed.access_outlets) {
        try {
          accessList = typeof parsed.access_outlets === 'string' ? JSON.parse(parsed.access_outlets) : parsed.access_outlets;
        } catch {
          accessList = [];
        }
      }
      setAllowedOutlets(Array.isArray(accessList) ? accessList.filter(Boolean) : []);
    })();
  }, []);

  const orderId = useMemo(() => investorOrderId(user), [user]);

  const loadQueries = async () => {
    const { data } = await supabase
      .from('support_chats')
      .select('id, sender_type, message, created_at, sender_name, is_internal')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .limit(80);
    setQueries((data || []).filter((m) => !isStaffOnlyMessage(m)));
  };

  useEffect(() => {
    if (!orderId || orderId === 'INV-anon') return;
    loadQueries();
    const ch = supabase
      .channel('investor_queries')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_chats' }, (payload) => {
        const row: any = payload.new;
        if (row?.order_id === orderId && !isStaffOnlyMessage(row)) {
          setQueries((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [orderId]);

  useEffect(() => {
    async function fetchInvestorData() {
      if (allowedOutlets.length === 0) {
        setIsLoading(false);
        setStats({ income: 0, expense: 0, profit: 0, trxCount: 0, roi: 0 });
        setOutletRows([]);
        setTableData([]);
        return;
      }
      setIsLoading(true);

      const { data: outletData } = await supabase.from('outlets').select('id, name').in('id', allowedOutlets);
      const outMap: Record<string, string> = {};
      (outletData || []).forEach((o: { id: string; name: string }) => {
        outMap[o.id] = o.name;
      });
      setOutletsMap(outMap);

      const outletsToQuery = selectedOutlet === 'ALL' ? allowedOutlets : [selectedOutlet];

      const [txRes, memRes, expRes] = await Promise.all([
        supabase.from('transactions').select('created_at, amount, service_type, order_type, outlet_id, status').in('outlet_id', outletsToQuery),
        supabase.from('membership_logs').select('created_at, price, package_name, outlet_id').in('outlet_id', outletsToQuery),
        supabase.from('expenses').select('created_at, amount, category, description, outlet_id').in('outlet_id', outletsToQuery)
      ]);

      const periodTxs = (txRes.data || []).filter((t) => inPeriod(t.created_at, period) && !isVoidTransaction(t));
      const periodMems = memRes.error ? [] : (memRes.data || []).filter((m) => inPeriod(m.created_at, period));
      const periodExps = (expRes.data || []).filter((e) => inPeriod(e.created_at, period));

      const byOutlet: Record<string, { income: number; expense: number; count: number }> = {};
      outletsToQuery.forEach((id) => {
        byOutlet[id] = { income: 0, expense: 0, count: 0 };
      });

      let inc = 0;
      let exp = 0;
      const combinedData: LedgerRow[] = [];

      periodTxs.forEach((t: any) => {
        const amt = Number(t.amount) || 0;
        inc += amt;
        if (byOutlet[t.outlet_id]) {
          byOutlet[t.outlet_id].income += amt;
          byOutlet[t.outlet_id].count += 1;
        }
        combinedData.push({
          date: t.created_at,
          type: 'Pemasukan',
          category: 'Laundry',
          desc: t.service_type || 'Layanan',
          amount: amt,
          outlet: outMap[t.outlet_id] || '—'
        });
      });
      periodMems.forEach((m: any) => {
        const amt = Number(m.price) || 0;
        inc += amt;
        if (byOutlet[m.outlet_id]) {
          byOutlet[m.outlet_id].income += amt;
          byOutlet[m.outlet_id].count += 1;
        }
        combinedData.push({
          date: m.created_at,
          type: 'Pemasukan',
          category: String(m.package_name || '').toLowerCase().includes('top up') ? 'Top Up Deposit' : 'Membership',
          desc: String(m.package_name || '').toLowerCase().includes('top up')
            ? `${m.package_name} · QRIS Mayar`
            : `Paket ${m.package_name || ''}`.trim(),
          amount: amt,
          outlet: outMap[m.outlet_id] || '—'
        });
      });
      periodExps.forEach((e: any) => {
        const amt = Number(e.amount) || 0;
        exp += amt;
        if (byOutlet[e.outlet_id]) byOutlet[e.outlet_id].expense += amt;
        const cat = String(e.category || 'Opex');
        const sensitive = /gaji|kasbon|pinjaman|penalty|denda|karyawan/i.test(`${cat} ${e.description || ''}`);
        combinedData.push({
          date: e.created_at,
          type: 'Pengeluaran',
          category: cat,
          desc: sensitive ? 'Biaya operasional (diringkas)' : String(e.description || cat),
          amount: -amt,
          outlet: outMap[e.outlet_id] || '—'
        });
      });

      combinedData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const profit = inc - exp;
      const roi = inc > 0 ? Math.round((profit / inc) * 1000) / 10 : 0;

      setStats({ income: inc, expense: exp, profit, trxCount: periodTxs.length + periodMems.length, roi });
      setOutletRows(
        outletsToQuery.map((id) => {
          const row = byOutlet[id] || { income: 0, expense: 0, count: 0 };
          const p = row.income - row.expense;
          return {
            id,
            name: outMap[id] || id,
            income: row.income,
            expense: row.expense,
            profit: p,
            roi: row.income > 0 ? Math.round((p / row.income) * 1000) / 10 : 0,
            share: profit !== 0 ? Math.round((p / (profit || 1)) * 1000) / 10 : 0
          };
        })
      );
      setTableData(combinedData);
      setIsLoading(false);
    }
    fetchInvestorData();
  }, [allowedOutlets, selectedOutlet, period]);

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = queryText.trim();
    if (!body) return;
    setSending(true);
    const { error } = await insertChatMessage({
      pickup_order_id: orderId,
      sender_type: 'investor',
      message: body,
      sender_name: investorName
    });
    setSending(false);
    if (error) return toast('Gagal kirim query: ' + error.message, 'err');
    setQueryText('');
    toast('Query terkirim ke Owner Relation.', 'ok');
    loadQueries();
  };

  const handleLogout = () => {
    localStorage.removeItem('laundry_user');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black flex items-center gap-2">
              <span>Laporan Investor</span>
              <span className="bg-emerald-600 text-[10px] px-2.5 py-0.5 rounded-full uppercase">Read Only</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Selamat datang, <b>{investorName}</b>. Omset & opex dari transaksi + expenses cabang Anda.
            </p>
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
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-4 items-end">
              <div className="w-full md:w-1/2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Cabang investasi</label>
                <select value={selectedOutlet} onChange={(e) => setSelectedOutlet(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-xs font-bold focus:border-emerald-500">
                  <option value="ALL">Semua cabang gabungan</option>
                  {allowedOutlets.map((id) => (
                    <option key={id} value={id}>
                      {outletsMap[id] || id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full md:w-1/2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Periode</label>
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-xs font-bold focus:border-emerald-500">
                  <option value="THIS_MONTH">Bulan Ini</option>
                  <option value="LAST_MONTH">Bulan Lalu</option>
                  <option value="ALL">Sepanjang Waktu</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Omset</p>
                <h2 className="text-2xl font-black text-slate-900 mt-2">Rp {stats.income.toLocaleString('id-ID')}</h2>
                <p className="text-[10px] text-slate-500 mt-2 font-medium">{stats.trxCount} transaksi (tanpa batal)</p>
              </div>
              <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Opex</p>
                <h2 className="text-2xl font-black text-rose-600 mt-2">Rp {stats.expense.toLocaleString('id-ID')}</h2>
              </div>
              <div className={`p-5 rounded-3xl border shadow-sm ${stats.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Net profit</p>
                <h2 className="text-2xl font-black mt-2 text-emerald-600">Rp {stats.profit.toLocaleString('id-ID')}</h2>
              </div>
              <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">ROI (margin)</p>
                <h2 className="text-2xl font-black text-sky-700 mt-2">{stats.roi}%</h2>
                <p className="text-[10px] text-slate-500 mt-2">Profit / omset periode</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm">Performa & profit sharing per cabang</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Share = kontribusi profit cabang terhadap net gabungan periode ini.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold">
                    <tr>
                      <th className="p-3">Cabang</th>
                      <th className="p-3 text-right">Omset</th>
                      <th className="p-3 text-right">Opex</th>
                      <th className="p-3 text-right">Profit</th>
                      <th className="p-3 text-right">ROI</th>
                      <th className="p-3 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outletRows.map((o) => (
                      <tr key={o.id} className="border-t border-slate-50">
                        <td className="p-3 font-bold">{o.name}</td>
                        <td className="p-3 text-right">Rp {o.income.toLocaleString('id-ID')}</td>
                        <td className="p-3 text-right text-rose-600">Rp {o.expense.toLocaleString('id-ID')}</td>
                        <td className="p-3 text-right font-black">Rp {o.profit.toLocaleString('id-ID')}</td>
                        <td className="p-3 text-right">{o.roi}%</td>
                        <td className="p-3 text-right">{o.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                <h3 className="font-bold text-slate-800 text-sm">Laporan transaksi & kas (terverifikasi)</h3>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded font-bold">{tableData.length} baris</span>
              </div>
              {isLoading ? (
                <p className="text-center py-8 text-xs font-bold text-slate-400 animate-pulse">Menyiapkan laporan...</p>
              ) : (
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold sticky top-0">
                      <tr>
                        <th className="p-4">Tgl</th>
                        <th className="p-4">Cabang</th>
                        <th className="p-4">Kategori</th>
                        <th className="p-4">Deskripsi</th>
                        <th className="p-4 text-right">Nominal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-50">
                          <td className="p-4 text-slate-500 font-mono text-[10px]">{new Date(row.date).toLocaleString('id-ID')}</td>
                          <td className="p-4 font-bold text-slate-700">{row.outlet}</td>
                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded text-[9px] font-bold ${row.type === 'Pemasukan' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {row.category}
                            </span>
                          </td>
                          <td className="p-4 text-slate-600">{row.desc}</td>
                          <td className={`p-4 text-right font-black ${row.type === 'Pemasukan' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {row.type === 'Pemasukan' ? '+' : ''} Rp {Math.abs(row.amount).toLocaleString('id-ID')}
                          </td>
                        </tr>
                      ))}
                      {tableData.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-slate-400 font-medium">
                            Tidak ada transaksi pada periode ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-800 text-sm">Query ke Owner Relation</h3>
              <p className="text-[10px] text-slate-400">Tiket ini masuk metrik response rate & waktu balas di kartu Owner Relation.</p>
              <div className="max-h-48 overflow-y-auto space-y-2 bg-slate-50 rounded-xl p-3">
                {queries.map((m) => (
                  <div key={m.id} className={`text-xs rounded-xl px-3 py-2 ${String(m.sender_type).toLowerCase() === 'investor' ? 'bg-white border border-slate-200' : 'bg-sky-50 border border-sky-100'}`}>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">{m.sender_name || m.sender_type}</p>
                    <p>{m.message}</p>
                  </div>
                ))}
                {queries.length === 0 && <p className="text-[11px] text-slate-400 text-center py-4">Belum ada query.</p>}
              </div>
              <form onSubmit={handleQuery} className="flex gap-2">
                <input
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Tulis pertanyaan keuangan / cabang…"
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
                <button disabled={sending} className="bg-emerald-600 text-white font-bold text-xs px-4 py-2 rounded-xl">
                  Kirim
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
