'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import OwnerChrome from '@/components/owner/OwnerChrome';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { loadOwnerFinanceBundle, filterByOutlet } from '@/lib/ownerFinanceData';
import { monthLabel, type PnlMonthRef } from '@/lib/pnlReport';
import { booksOf, idr, loadOutletBooks, type OutletBook } from '@/lib/outletBooks';
import {
  buildBalanceSheet,
  buildEquity,
  buildJournal,
  buildLedger
} from '@/lib/financeStatements';
import NeracaStatement from '@/components/owner/NeracaStatement';
import { loadProfitShareRates } from '@/lib/profitShare';

const META: Record<string, { title: string; tab: string; desc: string }> = {
  jurnal: { title: 'Jurnal Umum', tab: 'jurnal', desc: 'Double-entry: kas, pendapatan, beban, modal, aset, dan penyusutan' },
  'buku-besar': { title: 'Buku Besar', tab: 'buku-besar', desc: 'Saldo kumulatif per akun sampai akhir bulan terpilih' },
  'perubahan-modal': { title: 'Perubahan Modal', tab: 'perubahan-modal', desc: 'Modal, ekuitas saldo awal, laba tahun ini, dan prive' },
  neraca: { title: 'Neraca', tab: 'neraca', desc: 'Posisi keuangan: aset lancar, aset tetap per kelompok, liabilitas, dan ekuitas' }
};

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export default function OwnerFinanceKindPage() {
  const params = useParams();
  const kind = String(params?.kind || 'jurnal');
  const meta = META[kind] || META.jurnal;
  const now = new Date();
  const [ready, setReady] = useState(false);
  const [outletId, setOutletId] = useState('ALL');
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [mems, setMems] = useState<any[]>([]);
  const [exps, setExps] = useState<any[]>([]);
  const [store, setStore] = useState<Record<string, OutletBook>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = String(JSON.parse(raw).role || '').toLowerCase();
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    Promise.all([loadOwnerFinanceBundle(), loadOutletBooks(), loadProfitShareRates()]).then(([b, books, share]) => {
      setOutlets(b.outlets);
      setTxs(b.txs);
      setMems(b.mems);
      setExps(b.exps);
      setStore(books);
      setRates(share);
    });
  }, [ready]);

  const scopedTxs = filterByOutlet(txs, outletId);
  const scopedMems = filterByOutlet(mems, outletId);
  const scopedExps = filterByOutlet(exps, outletId);
  const books = booksOf(store, outletId);
  const ref: PnlMonthRef = { year, month };
  const years = useMemo(() => {
    const ys = new Set<number>([now.getFullYear()]);
    [...txs, ...mems, ...exps].forEach((r) => {
      const d = new Date(r.created_at);
      if (!Number.isNaN(d.getTime())) ys.add(d.getFullYear());
    });
    books.forEach((b) => {
      const d = new Date(b.booksStart);
      if (!Number.isNaN(d.getTime())) ys.add(d.getFullYear());
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [txs, mems, exps, store]);

  const journal = useMemo(
    () => buildJournal({ txs: scopedTxs, mems: scopedMems, exps: scopedExps, books, ref, mode: 'month' }),
    [scopedTxs, scopedMems, scopedExps, books, year, month]
  );
  const ledger = useMemo(
    () => buildLedger({ txs: scopedTxs, mems: scopedMems, exps: scopedExps, books, asOf: ref }),
    [scopedTxs, scopedMems, scopedExps, books, year, month]
  );
  const equity = useMemo(
    () => buildEquity({ txs: scopedTxs, mems: scopedMems, exps: scopedExps, books, ref }),
    [scopedTxs, scopedMems, scopedExps, books, year, month]
  );
  const neraca = useMemo(
    () => buildBalanceSheet({ txs: scopedTxs, mems: scopedMems, exps: scopedExps, books, asOf: ref, rates }),
    [scopedTxs, scopedMems, scopedExps, books, year, month, rates]
  );
  const outletTitle = outletId === 'ALL'
    ? 'NERACA SEMUA CABANG'
    : `NERACA ${(outlets.find((o) => o.id === outletId)?.name || 'OUTLET').toUpperCase()}`;

  const debitSum = journal.reduce((s, r) => s + r.debit, 0);
  const creditSum = journal.reduce((s, r) => s + r.kredit, 0);

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <OwnerChrome activeTab={meta.tab} eyebrow="Laporan Keuangan" title={meta.title} subtitle={meta.desc} />
        <div className="bg-white border rounded-2xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Outlet</label>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs font-bold">
              <option value="ALL">Semua Cabang</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Bulan</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs font-bold">
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Tahun</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs font-bold">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {books.every((b) => !(b.openingCapital || b.assets.some((a) => a.cost > 0))) && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Modal dan aset belum diisi. Buka Settings → Kelola outlet, lalu lengkapi pembukuan awal agar Neraca dan Perubahan Modal berimbang.
          </p>
        )}

        {kind === 'jurnal' && (
          <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-2 text-[11px] text-slate-500 border-b">
              {monthLabel(ref)} · Debit {idr(debitSum)} · Kredit {idr(creditSum)}
              {Math.abs(debitSum - creditSum) < 2 ? ' · seimbang' : ' · belum seimbang'}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold">
                  <tr>
                    <th className="p-3 text-left">Tanggal</th>
                    <th className="p-3 text-left">Akun</th>
                    <th className="p-3 text-left">Keterangan</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((r, i) => (
                    <tr key={`${r.group}-${i}`} className="border-t border-slate-100">
                      <td className="p-3 whitespace-nowrap">{new Date(r.date).toLocaleDateString('id-ID')}</td>
                      <td className="p-3 font-bold">{r.akun}</td>
                      <td className="p-3 text-slate-500">{r.desc}</td>
                      <td className="p-3 text-right">{r.debit ? idr(r.debit) : '—'}</td>
                      <td className="p-3 text-right">{r.kredit ? idr(r.kredit) : '—'}</td>
                    </tr>
                  ))}
                  {journal.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada jurnal di bulan ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {kind === 'buku-besar' && (
          <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold">
                <tr>
                  <th className="p-3 text-left">Akun</th>
                  <th className="p-3 text-right">Debit</th>
                  <th className="p-3 text-right">Kredit</th>
                  <th className="p-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.name} className="border-t border-slate-100">
                    <td className="p-3 font-bold">{r.name}</td>
                    <td className="p-3 text-right">{idr(r.debit)}</td>
                    <td className="p-3 text-right">{idr(r.kredit)}</td>
                    <td className={`p-3 text-right font-black ${r.saldo < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{idr(r.saldo)}</td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-400">Belum ada saldo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {kind === 'perubahan-modal' && (
          <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-2 text-sm max-w-2xl">
            <p className="text-[11px] text-slate-400 mb-2">Per {monthLabel(ref)}</p>
            <Row label="Modal" value={idr(neraca.paidInCapital)} />
            <Row label="Ekuitas saldo awal (1 Januari)" value={idr(neraca.equityBegin)} />
            <Row label="Setoran modal tahun ini" value={idr(neraca.extraYear)} />
            <Row label="Laba tahun ini (setelah penyusutan & bagi hasil)" value={idr(neraca.yearProfit)} />
            <Row label="Prive tahun ini" value={idr(neraca.drawingsYear)} />
            <Row label="Laba / rugi bulan ini" value={idr(equity.periodProfit)} />
            <Row label="Jumlah ekuitas" value={idr(neraca.totalEquity)} strong />
          </div>
        )}

        {kind === 'neraca' && (
          <div className="space-y-4">
            <NeracaStatement title={outletTitle} asOf={ref} sheet={neraca} />
            <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-black">Rincian aset tetap</h3>
                <p className="text-[11px] text-slate-400">Item di balik kelompok Machine, Furniture, Promotion Tools, Tools & Equipment, IT Solution, Renovation · {monthLabel(ref)}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold">
                    <tr>
                      <th className="p-3 text-left">Aset</th>
                      <th className="p-3 text-left">Kategori</th>
                      <th className="p-3 text-right">Perolehan</th>
                      <th className="p-3 text-right">Akum. susut</th>
                      <th className="p-3 text-right">Nilai buku</th>
                      <th className="p-3 text-center">Sisa (bln)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {neraca.assets.map((a, i) => (
                      <tr key={`${a.name}-${i}`} className="border-t border-slate-100">
                        <td className="p-3 font-bold">{a.name}</td>
                        <td className="p-3 text-slate-500">{a.category}</td>
                        <td className="p-3 text-right">{idr(a.cost)}</td>
                        <td className="p-3 text-right">{idr(a.accum)}</td>
                        <td className="p-3 text-right font-black">{idr(a.book)}</td>
                        <td className="p-3 text-center">{a.remainingMonths}×</td>
                      </tr>
                    ))}
                    {neraca.assets.length === 0 && (
                      <tr><td colSpan={6} className="p-6 text-center text-slate-400">Belum ada aset tetap.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-xs ${strong ? 'font-black border-t pt-2 mt-2' : 'font-semibold text-slate-600'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
