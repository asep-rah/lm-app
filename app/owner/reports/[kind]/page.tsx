'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import OwnerChrome from '@/components/owner/OwnerChrome';
import { canAccessSettings, homePathForRole, isOwnerRole } from '@/lib/staffSession';
import { loadOwnerFinanceBundle, filterByOutlet } from '@/lib/ownerFinanceData';
import { PNL_COGS, PNL_OPEX, PNL_REVENUE } from '@/lib/pnlReport';

const META: Record<string, { title: string; tab: string; desc: string }> = {
  jurnal: { title: 'Jurnal Umum', tab: 'jurnal', desc: 'Catatan kronologis pendapatan dan pengeluaran' },
  'buku-besar': { title: 'Buku Besar', tab: 'buku-besar', desc: 'Saldo per akun / kategori' },
  'perubahan-modal': { title: 'Perubahan Modal', tab: 'perubahan-modal', desc: 'Laba ditahan setelah beban periode ini' },
  neraca: { title: 'Neraca', tab: 'neraca', desc: 'Posisi kas operasional sederhana dari arus transaksi' }
};

const idr = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export default function OwnerFinanceKindPage() {
  const params = useParams();
  const kind = String(params?.kind || 'jurnal');
  const meta = META[kind] || META.jurnal;
  const [ready, setReady] = useState(false);
  const [outletId, setOutletId] = useState('ALL');
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [mems, setMems] = useState<any[]>([]);
  const [exps, setExps] = useState<any[]>([]);

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
    loadOwnerFinanceBundle().then((b) => {
      setOutlets(b.outlets);
      setTxs(b.txs);
      setMems(b.mems);
      setExps(b.exps);
    });
  }, [ready]);

  const scopedTxs = filterByOutlet(txs, outletId);
  const scopedMems = filterByOutlet(mems, outletId);
  const scopedExps = filterByOutlet(exps, outletId);

  const journal = useMemo(() => {
    const rows: { date: string; akun: string; desc: string; debit: number; kredit: number }[] = [];
    scopedTxs.forEach((t) => {
      rows.push({
        date: t.created_at,
        akun: t.order_type === 'Online' ? '400006 Pendapatan Online' : '400005 Pendapatan Offline',
        desc: `${t.receipt_number || 'TRX'} · ${t.customer_name || '-'}`,
        debit: 0,
        kredit: Number(t.amount) || 0
      });
    });
    scopedMems.forEach((m) => {
      rows.push({
        date: m.created_at,
        akun: '400008 Pendapatan Lainnya',
        desc: m.package_name || 'Member',
        debit: 0,
        kredit: Number(m.price) || 0
      });
    });
    scopedExps.forEach((e) => {
      rows.push({
        date: e.created_at,
        akun: e.category || 'Beban',
        desc: e.description || '-',
        debit: Number(e.amount) || 0,
        kredit: 0
      });
    });
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 250);
  }, [scopedTxs, scopedMems, scopedExps]);

  const ledger = useMemo(() => {
    const map: Record<string, { debit: number; kredit: number }> = {};
    const add = (name: string, debit: number, kredit: number) => {
      if (!map[name]) map[name] = { debit: 0, kredit: 0 };
      map[name].debit += debit;
      map[name].kredit += kredit;
    };
    PNL_REVENUE.forEach((a) => add(`${a.code} ${a.label}`, 0, 0));
    [...PNL_COGS, ...PNL_OPEX].forEach((a) => add(`${a.code} ${a.label}`, 0, 0));
    journal.forEach((r) => add(r.akun, r.debit, r.kredit));
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v, saldo: v.kredit - v.debit }))
      .filter((r) => r.debit || r.kredit)
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [journal]);

  const income = scopedTxs.reduce((s, t) => s + (Number(t.amount) || 0), 0) + scopedMems.reduce((s, m) => s + (Number(m.price) || 0), 0);
  const expense = scopedExps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const laba = income - expense;

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <OwnerChrome activeTab={meta.tab} eyebrow="Laporan Keuangan" title={meta.title} subtitle={meta.desc} />
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">Outlet</label>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="w-full md:w-72 bg-slate-50 border rounded-xl px-3 py-2 text-xs font-bold">
            <option value="ALL">Semua Cabang</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>

        {kind === 'jurnal' && (
          <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
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
                    <tr key={i} className="border-t border-slate-100">
                      <td className="p-3 whitespace-nowrap">{new Date(r.date).toLocaleString('id-ID')}</td>
                      <td className="p-3 font-bold">{r.akun}</td>
                      <td className="p-3 text-slate-500">{r.desc}</td>
                      <td className="p-3 text-right">{r.debit ? idr(r.debit) : '—'}</td>
                      <td className="p-3 text-right">{r.kredit ? idr(r.kredit) : '—'}</td>
                    </tr>
                  ))}
                  {journal.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada jurnal.</td></tr>}
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
              </tbody>
            </table>
          </div>
        )}

        {kind === 'perubahan-modal' && (
          <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-2 text-sm">
            <Row label="Modal awal (belum diinput)" value={idr(0)} />
            <Row label="Pendapatan periode" value={idr(income)} />
            <Row label="Beban periode" value={idr(expense)} />
            <Row label="Laba / rugi ditahan" value={idr(laba)} strong />
            <Row label="Modal akhir (estimasi)" value={idr(laba)} strong />
          </div>
        )}

        {kind === 'neraca' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-2">
              <h3 className="text-xs font-black uppercase text-slate-500">Aset</h3>
              <Row label="Kas operasional (omset − opex)" value={idr(laba)} />
              <Row label="Total aset (estimasi)" value={idr(laba)} strong />
            </div>
            <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-2">
              <h3 className="text-xs font-black uppercase text-slate-500">Kewajiban & Ekuitas</h3>
              <Row label="Kewajiban tercatat" value={idr(0)} />
              <Row label="Ekuitas / modal" value={idr(laba)} />
              <Row label="Total pasiva" value={idr(laba)} strong />
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
