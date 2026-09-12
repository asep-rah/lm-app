'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import OwnerChrome from '@/components/owner/OwnerChrome';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { loadOwnerFinanceBundle, filterByOutlet, ledgerTxsOf } from '@/lib/ownerFinanceData';
import { monthLabel, type PnlMonthRef } from '@/lib/pnlReport';
import { booksOf, idr, loadOutletBooks, type OutletBook } from '@/lib/outletBooks';
import {
  assessBooksCompleteness,
  buildBalanceSheet,
  buildEquity,
  buildJournal,
  buildLedger,
  buildLedgerAccount,
  journalGroupBalanceIssues,
  receivableRevenueOf,
  countMissingPaidAt
} from '@/lib/financeStatements';
import NeracaStatement from '@/components/owner/NeracaStatement';
import { loadProfitShareRates } from '@/lib/profitShare';

const META: Record<string, { title: string; tab: string; desc: string }> = {
  jurnal: {
    title: 'Jurnal Umum',
    tab: 'jurnal',
    desc: 'Double-entry: kas/piutang, pendapatan, beban, modal, aset, dan penyusutan'
  },
  'buku-besar': {
    title: 'Buku Besar',
    tab: 'buku-besar',
    desc: 'Ringkasan per akun + mutasi kronologis (klik akun untuk drill-down)'
  },
  'perubahan-modal': {
    title: 'Perubahan Modal',
    tab: 'perubahan-modal',
    desc: 'Modal, ekuitas saldo awal, laba (sebelum/sesudah bagi hasil), dan prive'
  },
  neraca: {
    title: 'Neraca',
    tab: 'neraca',
    desc: 'Posisi keuangan: aset lancar (kas vs piutang), aset tetap, liabilitas, dan ekuitas'
  }
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
  const [voidedTxs, setVoidedTxs] = useState<any[]>([]);
  const [mems, setMems] = useState<any[]>([]);
  const [exps, setExps] = useState<any[]>([]);
  const [store, setStore] = useState<Record<string, OutletBook>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [ledgerAccount, setLedgerAccount] = useState<string | null>(null);

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
      setVoidedTxs(b.voidedTxs);
      setMems(b.mems);
      setExps(b.exps);
      setStore(books);
      setRates(share);
    });
  }, [ready]);

  const scopedTxs = filterByOutlet(txs, outletId);
  const scopedVoided = filterByOutlet(voidedTxs, outletId);
  const scopedLedgerTxs = ledgerTxsOf({ txs: scopedTxs, voidedTxs: scopedVoided });
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
    () => buildJournal({ txs: scopedLedgerTxs, mems: scopedMems, exps: scopedExps, books, ref, mode: 'month' }),
    [scopedLedgerTxs, scopedMems, scopedExps, books, year, month]
  );
  const ledger = useMemo(
    () => buildLedger({ txs: scopedLedgerTxs, mems: scopedMems, exps: scopedExps, books, asOf: ref }),
    [scopedLedgerTxs, scopedMems, scopedExps, books, year, month]
  );
  const equity = useMemo(
    () => buildEquity({ txs: scopedTxs, mems: scopedMems, exps: scopedExps, books, ref, rates }),
    [scopedTxs, scopedMems, scopedExps, books, year, month, rates]
  );
  const neraca = useMemo(
    () => buildBalanceSheet({ txs: scopedLedgerTxs, mems: scopedMems, exps: scopedExps, books, asOf: ref, rates }),
    [scopedLedgerTxs, scopedMems, scopedExps, books, year, month, rates]
  );
  const completeness = useMemo(() => assessBooksCompleteness(books), [books]);
  const unpaidPeriod = useMemo(
    () => receivableRevenueOf(scopedTxs.filter((t) => {
      const d = new Date(t.created_at);
      return d.getFullYear() === year && d.getMonth() === month;
    }), ref),
    [scopedTxs, year, month]
  );
  const missingPaidAt = useMemo(() => countMissingPaidAt(scopedTxs), [scopedTxs]);
  const groupIssues = useMemo(() => journalGroupBalanceIssues(journal), [journal]);
  const ledgerDetail = useMemo(() => {
    if (!ledgerAccount) return null;
    return buildLedgerAccount({
      txs: scopedLedgerTxs,
      mems: scopedMems,
      exps: scopedExps,
      books,
      asOf: ref,
      account: ledgerAccount
    });
  }, [ledgerAccount, scopedLedgerTxs, scopedMems, scopedExps, books, year, month]);

  const outletTitle = outletId === 'ALL'
    ? 'NERACA SEMUA CABANG'
    : `NERACA ${(outlets.find((o) => o.id === outletId)?.name || 'OUTLET').toUpperCase()}`;

  const debitSum = journal.reduce((s, r) => s + r.debit, 0);
  const creditSum = journal.reduce((s, r) => s + r.kredit, 0);

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8 pb-28">
      <div className="max-w-6xl mx-auto space-y-4">
        <OwnerChrome activeTab={meta.tab} eyebrow="Laporan Keuangan" title={meta.title} subtitle={meta.desc} />
        <div className="bg-white border rounded-2xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="fin-outlet" className="block text-[10px] font-bold text-slate-500 mb-1">Outlet</label>
            <select id="fin-outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)} className="w-full bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-bold min-h-[44px]">
              <option value="ALL">Semua Cabang</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fin-month" className="block text-[10px] font-bold text-slate-500 mb-1">Bulan</label>
            <select id="fin-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-bold min-h-[44px]">
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fin-year" className="block text-[10px] font-bold text-slate-500 mb-1">Tahun</label>
            <select id="fin-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-bold min-h-[44px]">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {!completeness.complete && (
          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
            Status: <strong>pembukuan awal belum lengkap / belum diverifikasi</strong>.
            {' '}
            {completeness.issues[0] || 'Lengkapi di Settings → Kelola outlet.'}
            {' '}Neraca yang aritmetikanya seimbang belum berarti kas/aset sudah benar.
          </p>
        )}

        {unpaidPeriod > 0 && (
          <p className="text-[11px] text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">
            Periode {monthLabel(ref)}: omset masih di piutang (belum ada jurnal koleksi bertanggal) {idr(unpaidPeriod)}.
            Alur: jual non-tunai → 110002; lunas gateway (paid_at) → 110004 Clearing; tunai → 110005 KasBelumSetor;
            setor/settled → 110001 Bank.
          </p>
        )}

        {missingPaidAt > 0 && (
          <p className="text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 leading-relaxed">
            Gate rilis: {missingPaidAt} transaksi <strong>is_paid tanpa paid_at</strong> tetap di Piutang (aman, tanpa
            mengarang tanggal). Saldo produksi belum lengkap sampai backfill berbasis bukti + rekonsiliasi selesai.
            Jalankan <code className="text-[10px]">npx tsx scripts/paidAtBackfillDryRun.ts</code> (read-only).
          </p>
        )}

        {kind === 'jurnal' && (
          <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-2 text-[11px] text-slate-500 border-b space-y-1">
              <p>
                {monthLabel(ref)} · Debit {idr(debitSum)} · Kredit {idr(creditSum)}
                {Math.abs(debitSum - creditSum) < 2 ? ' · total bulan seimbang' : ' · total bulan belum seimbang'}
                {groupIssues.length
                  ? ` · ${groupIssues.length} bukti belum seimbang`
                  : ' · semua bukti (group) seimbang'}
              </p>
              <p className="text-[10px] text-slate-400">
                Jurnal sintetis bertanggal: penjualan pada created_at, koleksi pada paid_at/settled_at.
                Tanpa paid_at, mengubah is_paid saja tidak memindahkan piutang — itu batasan yang disengaja untuk menjaga jejak bulan.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold">
                  <tr>
                    <th className="p-3 text-left">Tanggal</th>
                    <th className="p-3 text-left">Ref</th>
                    <th className="p-3 text-left">Akun</th>
                    <th className="p-3 text-left">Keterangan</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((r, i) => (
                    <tr key={`${r.group}-${i}`} className="border-t border-slate-100">
                      <td className="p-3 whitespace-nowrap">{new Date(r.date).toLocaleDateString('id-ID')}</td>
                      <td className="p-3 font-mono text-[10px] text-slate-500">{r.ref || r.group}</td>
                      <td className="p-3 font-bold">{r.akun}</td>
                      <td className="p-3 text-slate-500">{r.desc}</td>
                      <td className="p-3 text-[10px] text-slate-500">
                        {r.payStatus === 'receivable' ? 'Piutang' : r.payStatus === 'cash' ? 'Kas' : r.source || '—'}
                      </td>
                      <td className="p-3 text-right">{r.debit ? idr(r.debit) : '—'}</td>
                      <td className="p-3 text-right">{r.kredit ? idr(r.kredit) : '—'}</td>
                    </tr>
                  ))}
                  {journal.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">Belum ada jurnal di bulan ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {kind === 'buku-besar' && (
          <div className="space-y-3">
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
                    <tr
                      key={r.name}
                      className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${ledgerAccount === r.name ? 'bg-sky-50' : ''}`}
                      onClick={() => setLedgerAccount(ledgerAccount === r.name ? null : r.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setLedgerAccount(ledgerAccount === r.name ? null : r.name);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-expanded={ledgerAccount === r.name}
                      aria-label={`Buka mutasi ${r.name}`}
                    >
                      <td className="p-3 font-bold text-sky-800 underline-offset-2 hover:underline">{r.name}</td>
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

            {ledgerDetail && (
              <div className="bg-white border border-sky-100 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Mutasi · {ledgerDetail.account}</h3>
                    <p className="text-[11px] text-slate-500">
                      Saldo berjalan sampai {monthLabel(ref)} · akhir {idr(ledgerDetail.closing)}
                    </p>
                  </div>
                  <button type="button" onClick={() => setLedgerAccount(null)} className="text-xs font-bold text-slate-500 min-h-[44px] px-2">
                    Tutup
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-bold">
                      <tr>
                        <th className="p-2 text-left">Tanggal</th>
                        <th className="p-2 text-left">Ref</th>
                        <th className="p-2 text-left">Keterangan</th>
                        <th className="p-2 text-right">Debit</th>
                        <th className="p-2 text-right">Kredit</th>
                        <th className="p-2 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerDetail.mutations.map((m, i) => (
                        <tr key={`${m.group}-${i}`} className="border-t border-slate-100">
                          <td className="p-2 whitespace-nowrap">{new Date(m.date).toLocaleDateString('id-ID')}</td>
                          <td className="p-2 font-mono text-[10px]">{m.ref}</td>
                          <td className="p-2 text-slate-600">{m.desc}</td>
                          <td className="p-2 text-right">{m.debit ? idr(m.debit) : '—'}</td>
                          <td className="p-2 text-right">{m.kredit ? idr(m.kredit) : '—'}</td>
                          <td className="p-2 text-right font-bold">{idr(m.balance)}</td>
                        </tr>
                      ))}
                      {ledgerDetail.mutations.length === 0 && (
                        <tr><td colSpan={6} className="p-4 text-center text-slate-400">Tidak ada mutasi.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {kind === 'perubahan-modal' && (
          <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-2 text-sm max-w-2xl">
            <p className="text-[11px] text-slate-400 mb-2">Per {monthLabel(ref)}</p>
            <Row label="Modal disetor (awal + tambahan kumulatif)" value={idr(neraca.paidInCapital)} />
            <Row label="Ekuitas saldo awal (1 Januari / awal tahun)" value={idr(neraca.equityBegin)} />
            <Row label="Setoran modal tambahan tahun ini" value={idr(neraca.extraYear)} />
            <Row label="Laba tahun ini setelah penyusutan & bagi hasil" value={idr(neraca.yearProfit)} />
            <Row label="Prive tahun ini" value={idr(neraca.drawingsYear)} />
            <Row label={`Laba / rugi ${monthLabel(ref)} sebelum bagi hasil`} value={idr(equity.periodProfit)} />
            <Row label={`Laba / rugi ${monthLabel(ref)} setelah bagi hasil`} value={idr(equity.periodProfitAfterShare)} />
            <Row label="Jumlah ekuitas (posisi neraca)" value={idr(neraca.totalEquity)} strong />
            <p className="text-[10px] text-slate-500 pt-2 leading-relaxed">
              “Laba bulan ini” dan “laba tahun ini” memakai basis yang berbeda: bulan = sebelum/sesudah bagi hasil periode;
              tahun = setelah bagi hasil YTD di neraca. Jangan samakan keduanya tanpa penyesuaian.
            </p>
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
