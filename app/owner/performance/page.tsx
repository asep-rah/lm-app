'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import OwnerChrome from '@/components/owner/OwnerChrome';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import {
  MONTHS_ID,
  defaultPeriodFilter,
  employeePerf,
  employeePhoneOf,
  idr,
  loadPerformanceBundle,
  outletStats,
  periodLabel,
  qtyFmt,
  revenueByDay,
  costByItem,
  serviceRows,
  type PeriodFilter,
  type PerformanceBundle
} from '@/lib/performanceReports';

const VIEWS = {
  outlet: { tab: 'performa-outlet', title: 'Performa Outlet', desc: 'Kuantitas, omzet, kunjungan, dan nota per cabang' },
  layanan: { tab: 'performa-layanan', title: 'Performa Layanan', desc: 'Hingga 50 layanan, filter periode dan outlet' },
  karyawan: { tab: 'performa-karyawan', title: 'Performa Karyawan', desc: 'Output per orang, termasuk kasir dan outletnya' },
  pendapatan: { tab: 'grafik-pendapatan', title: 'Grafik Pendapatan', desc: 'Kiloan, satuan, dan luas (karpet/gordyn)' },
  biaya: { tab: 'grafik-biaya', title: 'Grafik Biaya', desc: 'Biaya per item pengeluaran' },
  promosi: { tab: 'grafik-promosi', title: 'Grafik Promosi', desc: 'Banner aktif vs nonaktif' }
} as const;

type ViewKey = keyof typeof VIEWS;

export default function OwnerPerformancePage() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewKey>('outlet');
  const [draft, setDraft] = useState<PeriodFilter>(defaultPeriodFilter);
  const [applied, setApplied] = useState<PeriodFilter>(defaultPeriodFilter);
  const [bundle, setBundle] = useState<PerformanceBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [empId, setEmpId] = useState('');
  const [paidOnly, setPaidOnly] = useState(true);
  const [openList, setOpenList] = useState('');
  const [promos, setPromos] = useState<any[]>([]);

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
    const q = new URLSearchParams(window.location.search).get('view') || 'outlet';
    if (q in VIEWS) setView(q as ViewKey);
    setReady(true);
  }, []);

  const load = async () => {
    setLoading(true);
    const [b, promo] = await Promise.all([
      loadPerformanceBundle(),
      supabase.from('promotions').select('id, title, is_active, promo_code')
    ]);
    setBundle(b);
    setPromos(promo.data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  const applyFilter = () => setApplied({ ...draft });

  const meta = VIEWS[view];
  const employees = useMemo(() => {
    if (!bundle) return [];
    return bundle.employees.filter((e) => applied.outletId === 'ALL' || e.outlet_id === applied.outletId);
  }, [bundle, applied.outletId]);
  const selectedEmp = employees.find((e) => String(e.id) === empId) || null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <OwnerChrome activeTab={meta.tab} eyebrow="Performa Usaha" title={meta.title} subtitle={meta.desc} />

        {view !== 'promosi' && (
          <PeriodBar
            draft={draft}
            setDraft={setDraft}
            outlets={bundle?.outlets || []}
            onApply={applyFilter}
            loading={loading}
          />
        )}

        {loading && !bundle ? <p className="text-xs text-slate-400">Memuat data…</p> : null}

        {bundle && view === 'outlet' && (
          <OutletView
            bundle={bundle}
            filter={applied}
            openList={openList}
            setOpenList={setOpenList}
          />
        )}
        {bundle && view === 'layanan' && <LayananView bundle={bundle} filter={applied} />}
        {bundle && view === 'karyawan' && (
          <KaryawanView
            bundle={bundle}
            filter={applied}
            employees={employees}
            selected={selectedEmp}
            onSelect={(id) => setEmpId(id)}
            paidOnly={paidOnly}
            setPaidOnly={setPaidOnly}
          />
        )}
        {bundle && view === 'pendapatan' && <PendapatanView bundle={bundle} filter={applied} />}
        {bundle && view === 'biaya' && <BiayaView bundle={bundle} filter={applied} />}
        {view === 'promosi' && (
          <div className="bg-white border rounded-2xl p-5 shadow-sm grid grid-cols-2 md:grid-cols-3 gap-3">
            <MiniStat label="Total promo" value={String(promos.length)} />
            <MiniStat label="Aktif" value={String(promos.filter((p) => p.is_active !== false).length)} />
            <MiniStat label="Nonaktif" value={String(promos.filter((p) => p.is_active === false).length)} />
          </div>
        )}
      </div>
    </div>
  );
}

function PeriodBar({
  draft,
  setDraft,
  outlets,
  onApply,
  loading
}: {
  draft: PeriodFilter;
  setDraft: (n: PeriodFilter) => void;
  outlets: { id: string; name: string }[];
  onApply: () => void;
  loading: boolean;
}) {
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <label className="text-[10px] font-bold text-slate-500 uppercase block">
          Cari Berdasarkan
          <select
            value={draft.mode}
            onChange={(e) => setDraft({ ...draft, mode: e.target.value as PeriodFilter['mode'] })}
            className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
          >
            <option value="bulan">Bulan</option>
            <option value="periode">Periode</option>
          </select>
        </label>
        {draft.mode === 'bulan' ? (
          <>
            <label className="text-[10px] font-bold text-slate-500 uppercase block">
              Bulan
              <select
                value={draft.month}
                onChange={(e) => setDraft({ ...draft, month: Number(e.target.value) })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              >
                {MONTHS_ID.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500 uppercase block">
              Tahun
              <select
                value={draft.year}
                onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="text-[10px] font-bold text-slate-500 uppercase block">
              Dari
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              />
            </label>
            <label className="text-[10px] font-bold text-slate-500 uppercase block">
              Sampai
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
              />
            </label>
          </>
        )}
        <label className="text-[10px] font-bold text-slate-500 uppercase block">
          Pilih Outlet
          <select
            value={draft.outletId}
            onChange={(e) => setDraft({ ...draft, outletId: e.target.value })}
            className="mt-1 w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold bg-slate-50"
          >
            <option value="ALL">Semua outlet</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onApply}
          disabled={loading}
          className="self-end bg-sky-600 text-white font-bold text-xs py-2.5 rounded-xl disabled:opacity-60"
        >
          Tampilkan Data
        </button>
      </div>
    </div>
  );
}

function OutletView({
  bundle,
  filter,
  openList,
  setOpenList
}: {
  bundle: PerformanceBundle;
  filter: PeriodFilter;
  openList: string;
  setOpenList: (k: string) => void;
}) {
  const s = outletStats(bundle, filter);
  const toggle = (k: string) => setOpenList(openList === k ? '' : k);
  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-slate-600">Statistik {periodLabel(filter)}</p>
      <div className="bg-teal-600 text-white text-[11px] font-semibold rounded-xl px-4 py-2.5">
        Info : Klik pada section yang ada logo {'>'} untuk melihat list transaksi di section itu.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <WhiteCard title="Kuantitas Masuk">
          <Row label="Kiloan" value={`${qtyFmt(s.qty.kg, 0)} KG`} />
          <Row label="Satuan" value={`${qtyFmt(s.qty.pcs)} Item`} />
          <Row label="Luas (karpet/gordyn)" value={`${qtyFmt(s.qty.m2, 1)} M²`} />
        </WhiteCard>
        <WhiteCard title="Laporan Pekerjaan">
          <ClickRow
            label="Terantar"
            value={`${s.work.delivered} dari ${s.work.deliveredAll}`}
            on={openList === 'delivered'}
            onClick={() => toggle('delivered')}
            tone="text-emerald-600"
          />
          <ClickRow
            label="Transaksi (Normal) Terselesaikan"
            value={`${s.work.normalDone} dari ${s.work.normalAll}`}
            on={openList === 'normal'}
            onClick={() => toggle('normal')}
            tone="text-emerald-600"
          />
          <ClickRow
            label="Transaksi (Express) Terselesaikan"
            value={`${s.work.expressDone} dari ${s.work.expressAll}`}
            on={openList === 'express'}
            onClick={() => toggle('express')}
            tone="text-emerald-600"
          />
        </WhiteCard>
      </div>
      {openList === 'delivered' && <TxList rows={s.lists.delivered} />}
      {openList === 'normal' && <TxList rows={s.lists.normalDone} />}
      {openList === 'express' && <TxList rows={s.lists.expressDone} />}

      <WhiteCard
        title="Total Omzet"
        hint="Pendapatan transaksi dan tarif express, belum termasuk pajak, diskon serta biaya layanan"
        right={`${s.omzet.nota} Nota / ${idr(s.omzet.total)}`}
      >
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 items-center">
          <Donut
            slices={[
              { value: s.omzet.regularAmt, color: '#7c3aed' },
              { value: s.omzet.depositAmt, color: '#f9a8d4' },
              { value: s.omzet.memberAmt, color: '#facc15' }
            ]}
          />
          <div>
            <ClickRow
              label="Transaksi Reguler"
              value={`${s.omzet.regularCount} Nota · ${idr(s.omzet.regularAmt)}`}
              dot="#7c3aed"
              on={openList === 'reg'}
              onClick={() => toggle('reg')}
            />
            <ClickRow
              label="Transaksi Deposit"
              value={`${s.omzet.depositCount} Nota · ${idr(s.omzet.depositAmt)}`}
              dot="#f9a8d4"
              on={openList === 'dep'}
              onClick={() => toggle('dep')}
            />
            <ClickRow
              label="Pendaftaran Member"
              value={`${s.omzet.memberCount} Nota · ${idr(s.omzet.memberAmt)}`}
              dot="#facc15"
              on={openList === 'mem'}
              onClick={() => toggle('mem')}
            />
          </div>
        </div>
      </WhiteCard>
      {openList === 'reg' && <TxList rows={s.lists.regular} />}
      {openList === 'dep' && <TxList rows={s.lists.deposit} extra="package_name" />}
      {openList === 'mem' && <TxList rows={s.lists.member} extra="package_name" />}

      <WhiteCard title="Kunjungan Konsumen" right={`${s.visits.total} Orang`}>
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 items-center">
          <Donut
            slices={[
              { value: s.visits.fresh, color: '#7c3aed' },
              { value: s.visits.returning, color: '#f9a8d4' }
            ]}
          />
          <div>
            <Row label="Konsumen Baru" value={`${s.visits.fresh} Orang`} dot="#7c3aed" />
            <Row label="Konsumen Lama" value={`${s.visits.returning} Orang`} dot="#f9a8d4" />
          </div>
        </div>
      </WhiteCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <WhiteCard title="Nota Terhapus" right={`${s.deleted.total} Nota`}>
          <ClickRow label="Transaksi Reguler" value={`${s.deleted.regular} Nota`} on={openList === 'del'} onClick={() => toggle('del')} />
          <Row label="Transaksi Deposit" value={`${s.deleted.deposit} Nota`} />
        </WhiteCard>
        <WhiteCard title="Nota Terambil" right={`${s.collected.total} Nota`}>
          <ClickRow
            label="Transaksi Reguler"
            value={`${s.collected.regular} Nota`}
            on={openList === 'col'}
            onClick={() => toggle('col')}
            tone="text-emerald-600"
          />
          <Row label="Transaksi Deposit" value={`${s.collected.deposit} Nota`} />
        </WhiteCard>
      </div>
      {openList === 'del' && <TxList rows={s.lists.deleted} />}
      {openList === 'col' && <TxList rows={s.lists.collected} />}
    </div>
  );
}

function LayananView({ bundle, filter }: { bundle: PerformanceBundle; filter: PeriodFilter }) {
  const rows = serviceRows(bundle, filter);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <p className="px-4 py-3 text-xs font-bold text-slate-500">Statistik {periodLabel(filter)} · max 50 layanan</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-500 font-bold">
            <tr>
              <th className="p-3 text-left w-10">No</th>
              <th className="p-3 text-left">Nama Layanan</th>
              <th className="p-3 text-left">Lokasi Outlet</th>
              <th className="p-3 text-left">Jumlah Kuantitas</th>
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${r.outlet}`} className={i % 2 ? 'bg-sky-50/60' : 'bg-white'}>
                <td className="p-3">{i + 1}</td>
                <td className="p-3 font-bold text-slate-800">{r.name}</td>
                <td className="p-3">{r.outlet}</td>
                <td className="p-3">{r.qty}</td>
                <td className="p-3 text-right font-black">{idr(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  Belum ada layanan pada filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KaryawanView({
  bundle,
  filter,
  employees,
  selected,
  onSelect,
  paidOnly,
  setPaidOnly
}: {
  bundle: PerformanceBundle;
  filter: PeriodFilter;
  employees: any[];
  selected: any;
  onSelect: (id: string) => void;
  paidOnly: boolean;
  setPaidOnly: (v: boolean) => void;
}) {
  if (!selected) {
    return (
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-xs text-slate-500">Pilih karyawan / kasir untuk melihat detail output.</p>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold">
            <tr>
              <th className="p-3 text-left">Nama</th>
              <th className="p-3 text-left">Peran</th>
              <th className="p-3 text-left">Outlet</th>
              <th className="p-3 text-left">Telepon</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 hover:bg-sky-50 cursor-pointer" onClick={() => onSelect(String(e.id))}>
                <td className="p-3 font-bold">{e.name}</td>
                <td className="p-3 uppercase">{e.role || '-'}</td>
                <td className="p-3">{outletNameOf(e, bundle)}</td>
                <td className="p-3">{employeePhoneOf(e)}</td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-slate-400">
                  Tidak ada karyawan pada filter outlet ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const p = employeePerf(bundle, filter, selected, paidOnly);
  const outletName = outletNameOf(selected, bundle);
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => onSelect('')} className="text-xs font-bold text-sky-700">
        ← Daftar karyawan
      </button>
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <p className="text-lg font-black text-slate-900">{selected.name}</p>
        <p className="text-xs text-slate-500">
          {String(selected.role || '').toUpperCase() || 'STAFF'} · {outletName} · {employeePhoneOf(selected)}
        </p>
        <label className="mt-3 flex items-center justify-end gap-2 text-[11px] font-bold text-slate-600">
          Hitung Yang Digaji
          <input type="checkbox" checked={paidOnly} onChange={(e) => setPaidOnly(e.target.checked)} />
        </label>
        {paidOnly && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Total yang digaji (semua produksi)</p>
            <p className="text-2xl font-black text-emerald-800 tabular-nums">{idr(p.wage)}</p>
            <p className="text-[10px] text-emerald-700/80 mt-1">
              Upah = kuantitas tahap × tarif komisi layanan (Sortir/Cuci/Kering/Setrika/Pengemasan).
              {p.wage === 0 ? ' Isi tarif komisi di Pengaturan Umum → layanan bila masih Rp 0.' : ''}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <MiniStat label="Total Nota" value={String(p.nota)} />
          <MiniStat label="Total Tahapan Yang Dikerjakan" value={String(p.stages)} />
          <MiniStat label="Total Layanan" value={String(p.layanan)} />
          <MiniStat label="Total Nominal Layanan" value={idr(p.nominal)} />
          <MiniStat label="Total Kilo" value={`${qtyFmt(p.qty.kg, 0)} Kg`} />
          <MiniStat label="Total Luas" value={`${qtyFmt(p.qty.m2, 1)} M²`} />
          <MiniStat label="Total Satuan" value={`${qtyFmt(p.qty.pcs)} Pcs`} />
          <MiniStat label="Total Load" value="0 Load" />
        </div>
      </div>
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-black">Detail Performa Karyawan</p>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold">
            <tr>
              <th className="p-3 text-left">Tahapan</th>
              <th className="p-3 text-right">Jumlah Kilo</th>
              <th className="p-3 text-right">Jumlah Luas</th>
              <th className="p-3 text-right">Jumlah Satuan</th>
              <th className="p-3 text-right">Jumlah Load</th>
              {paidOnly ? <th className="p-3 text-right">Upah</th> : null}
            </tr>
          </thead>
          <tbody>
            {p.stageRows.map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${r.tone}`}>{r.label}</span>
                </td>
                <td className="p-3 text-right font-bold">{qtyFmt(r.kg, 0)} Kg</td>
                <td className="p-3 text-right font-bold">{qtyFmt(r.m2, 1)} M²</td>
                <td className="p-3 text-right font-bold">{qtyFmt(r.pcs)} Pcs</td>
                <td className="p-3 text-right font-bold">{r.load} Load</td>
                {paidOnly ? <td className="p-3 text-right font-black text-emerald-700">{idr(r.wage)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PendapatanView({ bundle, filter }: { bundle: PerformanceBundle; filter: PeriodFilter }) {
  const { series, totals, dayCount } = revenueByDay(bundle, filter);
  const qtyTotal = totals.kiloan.amount + totals.satuan.amount + totals.luas.amount;
  return (
    <div className="space-y-3">
      <LineCard
        title="Grafik Pendapatan"
        labels={series.map((s) => s.label)}
        lines={[
          { name: 'Kiloan', color: '#f9a8d4', points: series.map((s) => s.kiloan) },
          { name: 'Satuan', color: '#38bdf8', points: series.map((s) => s.satuan) },
          { name: 'Luas', color: '#4ade80', points: series.map((s) => s.luas) }
        ]}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <WhiteCard title="Total (Belum termasuk pajak & diskon)">
          <Row label={`Kiloan · ${qtyFmt(totals.kiloan.kg, 1)} Kg`} value={idr(totals.kiloan.amount)} />
          <Row label={`Satuan · ${qtyFmt(totals.satuan.pcs)} Satuan`} value={idr(totals.satuan.amount)} />
          <Row label={`Luas · ${qtyFmt(totals.luas.m2, 1)} M²`} value={idr(totals.luas.amount)} />
          <Row label="Total Pendapatan (Kuantitas)" value={idr(qtyTotal)} />
          <Row label="Tarif tambahan" value={idr(totals.fee)} />
          <Row label="Total Omset" value={idr(totals.omset)} />
          <Link href="/owner/performance?view=outlet" className="mt-3 block text-center bg-sky-600 text-white font-bold text-xs py-2.5 rounded-xl">
            Lihat Performa Outlet
          </Link>
        </WhiteCard>
        <WhiteCard title="Rata - Rata">
          <Row label={`Kiloan · ${qtyFmt(totals.kiloan.kg / dayCount, 2)} Kg`} value={idr(totals.kiloan.amount / dayCount)} />
          <Row label={`Satuan · ${qtyFmt(totals.satuan.pcs / dayCount, 2)} Satuan`} value={idr(totals.satuan.amount / dayCount)} />
          <Row label={`Luas · ${qtyFmt(totals.luas.m2 / dayCount, 2)} M²`} value={idr(totals.luas.amount / dayCount)} />
          <Row label="Rata - Rata Total Kuantitas" value={idr(qtyTotal / dayCount)} />
          <Link href="/owner/reports/laba-rugi" className="mt-3 block text-center bg-sky-600 text-white font-bold text-xs py-2.5 rounded-xl">
            Lihat Laporan Laba Rugi
          </Link>
        </WhiteCard>
      </div>
    </div>
  );
}

function BiayaView({ bundle, filter }: { bundle: PerformanceBundle; filter: PeriodFilter }) {
  const { days, items } = costByItem(bundle, filter);
  const palette = ['#f43f5e', '#f59e0b', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];
  return (
    <div className="space-y-3">
      <LineCard
        title="Grafik Biaya per Item"
        labels={days}
        lines={items.map((it, i) => ({ name: it.name, color: palette[i % palette.length], points: it.points }))}
      />
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold">
            <tr>
              <th className="p-3 text-left">Item biaya</th>
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.name} className="border-t border-slate-100">
                <td className="p-3 font-bold">
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: palette[i % palette.length] }} />
                  {it.name}
                </td>
                <td className="p-3 text-right font-black">{idr(it.total)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={2} className="p-6 text-center text-slate-400">
                  Belum ada pengeluaran pada filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function outletNameOf(emp: any, bundle: PerformanceBundle) {
  const joined = emp?.outlets;
  if (Array.isArray(joined) && joined[0]?.name) return String(joined[0].name);
  if (joined?.name) return String(joined.name);
  return bundle.outlets.find((o) => o.id === emp?.outlet_id)?.name || '—';
}

function WhiteCard({
  title,
  hint,
  right,
  children
}: {
  title: string;
  hint?: string;
  right?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">{title}</p>
          {hint ? <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p> : null}
        </div>
        {right ? <p className="text-sm font-black text-sky-600 shrink-0">{right}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-slate-100 text-xs">
      <span className="text-slate-600 font-semibold inline-flex items-center gap-2">
        {dot ? <span className="w-2 h-2 rounded-full" style={{ background: dot }} /> : null}
        {label}
      </span>
      <span className="font-black text-slate-800">{value}</span>
    </div>
  );
}

function ClickRow({
  label,
  value,
  on,
  onClick,
  tone,
  dot
}: {
  label: string;
  value: string;
  on?: boolean;
  onClick?: () => void;
  tone?: string;
  dot?: string;
}) {
  return (
    <button type="button" onClick={onClick} className="w-full flex justify-between gap-3 py-2 border-b border-slate-100 text-xs text-left">
      <span className="text-slate-600 font-semibold inline-flex items-center gap-2">
        {dot ? <span className="w-2 h-2 rounded-full" style={{ background: dot }} /> : null}
        {label}
      </span>
      <span className={`font-black ${tone || 'text-slate-800'}`}>
        {value} <span className={`ml-1 ${on ? 'text-sky-600' : 'text-slate-300'}`}>{'>'}</span>
      </span>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-100 rounded-xl p-2.5 bg-slate-50">
      <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
      <p className="text-sm font-black text-slate-900 mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

function TxList({ rows, extra }: { rows: any[]; extra?: string }) {
  return (
    <div className="bg-white border rounded-2xl overflow-hidden text-xs">
      {rows.slice(0, 40).map((r) => (
        <div key={r.id || r.receipt_number || Math.random()} className="flex justify-between gap-2 px-3 py-2 border-b border-slate-100">
          <span className="font-bold truncate">
            {r.receipt_number || r.package_name || r.customer_name || 'Transaksi'}
            {extra && r[extra] ? ` · ${r[extra]}` : ''}
          </span>
          <span className="font-black shrink-0">{idr(r.amount || r.price || 0)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="p-4 text-center text-slate-400">Tidak ada transaksi.</p>}
    </div>
  );
}

function Donut({ slices }: { slices: { value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  let acc = 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" className="w-36 h-36 mx-auto">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#f1f5f9" strokeWidth="16" />
      {slices.map((s, i) => {
        const len = (Math.max(0, s.value) / total) * c;
        const dash = `${len} ${c - len}`;
        const rot = (acc / total) * 360 - 90;
        acc += Math.max(0, s.value);
        return (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="16"
            strokeDasharray={dash}
            transform={`rotate(${rot} 60 60)`}
          />
        );
      })}
    </svg>
  );
}

function LineCard({
  title,
  labels,
  lines
}: {
  title: string;
  labels: string[];
  lines: { name: string; color: string; points: number[] }[];
}) {
  const w = 640;
  const h = 220;
  const pad = 28;
  const max = Math.max(1, ...lines.flatMap((l) => l.points));
  const n = Math.max(1, labels.length - 1);
  const pathOf = (pts: number[]) =>
    pts
      .map((v, i) => {
        const x = pad + (i / n) * (w - pad * 2);
        const y = h - pad - (v / max) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  return (
    <div className="bg-white border rounded-2xl p-4 shadow-sm">
      <p className="text-sm font-black text-center mb-2">{title}</p>
      <div className="flex flex-wrap justify-center gap-3 text-[10px] font-bold mb-2">
        {lines.map((l) => (
          <span key={l.name} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-56">
        {[0, 0.5, 1].map((p) => (
          <line key={p} x1={pad} x2={w - pad} y1={h - pad - p * (h - pad * 2)} y2={h - pad - p * (h - pad * 2)} stroke="#e2e8f0" />
        ))}
        {lines.map((l) => (
          <path key={l.name} d={pathOf(l.points)} fill="none" stroke={l.color} strokeWidth="2.5" />
        ))}
        {labels.map((lb, i) =>
          i % Math.ceil(labels.length / 10) === 0 ? (
            <text key={lb + i} x={pad + (i / n) * (w - pad * 2)} y={h - 8} fontSize="9" textAnchor="middle" fill="#94a3b8">
              {lb}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
