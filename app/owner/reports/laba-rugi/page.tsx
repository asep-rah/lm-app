'use client';

import { useEffect, useMemo, useState } from 'react';
import OwnerChrome from '@/components/owner/OwnerChrome';
import PnlStatement from '@/components/owner/PnlStatement';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { loadOwnerFinanceBundle, filterByOutlet } from '@/lib/ownerFinanceData';
import {
  buildPnlByOutlets,
  buildPnlCsv,
  downloadCsv,
  pnlCompareMonths,
  printPnlPdf
} from '@/lib/pnlReport';
import { DEFAULT_PROFIT_SHARE_PCT, loadProfitShareRates, saveProfitShareRates } from '@/lib/profitShare';
import { booksOf, loadOutletBooks, monthDepreciation, type OutletBook } from '@/lib/outletBooks';

export default function LabaRugiPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState('Owner');
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [source, setSource] = useState({ txs: [] as any[], mems: [] as any[], exps: [] as any[] });
  const [bookStore, setBookStore] = useState<Record<string, OutletBook>>({});
  const [selectedOutlet, setSelectedOutlet] = useState('ALL');
  const [period, setPeriod] = useState('THIS_MONTH');
  const [rates, setRates] = useState<Record<string, number>>({});
  const [savingRates, setSavingRates] = useState(false);
  const [rateMsg, setRateMsg] = useState('');

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const user = JSON.parse(raw);
    const role = String(user.role || '').toLowerCase();
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setAdminName(String(user.name || 'Owner'));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [bundle, savedRates, books] = await Promise.all([loadOwnerFinanceBundle(), loadProfitShareRates(), loadOutletBooks()]);
      if (cancelled) return;
      setOutlets(bundle.outlets);
      setSource({ txs: bundle.txs, mems: bundle.mems, exps: bundle.exps });
      setBookStore(books);
      const next: Record<string, number> = {};
      bundle.outlets.forEach((o) => {
        next[o.id] = Number.isFinite(Number(savedRates[o.id])) ? Number(savedRates[o.id]) : DEFAULT_PROFIT_SHARE_PCT;
      });
      setRates(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const scoped = useMemo(() => ({
    txs: filterByOutlet(source.txs, selectedOutlet),
    mems: filterByOutlet(source.mems, selectedOutlet),
    exps: filterByOutlet(source.exps, selectedOutlet)
  }), [source, selectedOutlet]);

  const outletIds = selectedOutlet === 'ALL' ? outlets.map((o) => o.id) : [selectedOutlet];
  const [leftRef, rightRef] = pnlCompareMonths(period);
  const depMaps = useMemo(() => {
    const left: Record<string, number> = {};
    const right: Record<string, number> = {};
    outlets.forEach((o) => {
      const book = booksOf(bookStore, o.id)[0];
      left[o.id] = book ? monthDepreciation(book, leftRef) : 0;
      right[o.id] = book ? monthDepreciation(book, rightRef) : 0;
    });
    return { left, right };
  }, [bookStore, outlets, leftRef.year, leftRef.month, rightRef.year, rightRef.month]);
  const left = useMemo(
    () => buildPnlByOutlets({ ...scoped, depreciationByOutlet: depMaps.left, depreciation: Object.values(depMaps.left).reduce((s, n) => s + n, 0) }, leftRef, outletIds, rates),
    [scoped, leftRef.year, leftRef.month, outletIds.join(','), JSON.stringify(rates), JSON.stringify(depMaps.left)]
  );
  const right = useMemo(
    () => buildPnlByOutlets({ ...scoped, depreciationByOutlet: depMaps.right, depreciation: Object.values(depMaps.right).reduce((s, n) => s + n, 0) }, rightRef, outletIds, rates),
    [scoped, rightRef.year, rightRef.month, outletIds.join(','), JSON.stringify(rates), JSON.stringify(depMaps.right)]
  );
  const outletName = selectedOutlet === 'ALL' ? 'SEMUA CABANG' : outlets.find((o) => o.id === selectedOutlet)?.name?.toUpperCase() || 'OUTLET';

  const saveRates = async () => {
    setSavingRates(true);
    const { error } = await saveProfitShareRates(rates);
    setRateMsg(error ? `Gagal: ${error}` : '✅ Bagi hasil per outlet tersimpan');
    setSavingRates(false);
    setTimeout(() => setRateMsg(''), 3500);
  };

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
        <OwnerChrome
          activeTab="laba-rugi"
          eyebrow="Laporan Keuangan"
          title="Laporan Laba Rugi"
          subtitle="Format akuntansi 2 bulan · bagi hasil bisa berbeda per outlet"
          extra={
            <>
              <button
                type="button"
                onClick={() => downloadCsv(`Laporan_PnL_${outletName.replace(/ /g, '_')}.csv`, buildPnlCsv({ outletName, adminName, left, right }))}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-blue-600 text-white"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => printPnlPdf({ outletName, adminName, left, right })}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-slate-900 text-white"
              >
                Export PDF
              </button>
            </>
          }
        />

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Outlet</label>
            <select value={selectedOutlet} onChange={(e) => setSelectedOutlet(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold">
              <option value="ALL">Semua Cabang</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Periode acuan</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold">
              <option value="THIS_MONTH">Bulan ini vs bulan lalu</option>
              <option value="LAST_MONTH">Bulan lalu vs 2 bulan lalu</option>
            </select>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-900">Bagi hasil pengelolaan per outlet</h3>
              <p className="text-[11px] text-slate-500">Persentase dipotong dari laba bersih outlet tersebut. Default {DEFAULT_PROFIT_SHARE_PCT}%.</p>
            </div>
            <button type="button" onClick={saveRates} disabled={savingRates} className="text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-60">
              {savingRates ? 'Menyimpan…' : 'Simpan %'}
            </button>
          </div>
          {rateMsg && <p className="text-xs font-bold text-emerald-600">{rateMsg}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {outlets.map((o) => (
              <label key={o.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
                <span className="text-xs font-bold text-slate-700 truncate">{o.name}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={rates[o.id] ?? DEFAULT_PROFIT_SHARE_PCT}
                    onChange={(e) => setRates((prev) => ({ ...prev, [o.id]: Number(e.target.value) }))}
                    className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-xs font-black text-right"
                  />
                  <span className="text-[11px] font-bold text-slate-500">%</span>
                </span>
              </label>
            ))}
            {outlets.length === 0 && <p className="text-xs text-slate-400">Belum ada outlet.</p>}
          </div>
        </div>

        {loading ? (
          <div className="bg-white border rounded-2xl p-8 text-center text-xs text-slate-400">Memuat laporan…</div>
        ) : (
          <PnlStatement outletName={outletName} adminName={adminName} left={left} right={right} />
        )}
      </div>
    </div>
  );
}
