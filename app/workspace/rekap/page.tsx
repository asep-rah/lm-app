'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, homePathForRole, isAdminOpsRole } from '@/lib/staffSession';
import { toast } from '@/lib/toast';
import {
  VENDOR_SOURCE,
  addManualUsage,
  currentPeriod,
  downloadVendorRecapCsv,
  grandTotal,
  isEntryBilled,
  loadUsageEntries,
  loadVendorAccounts,
  markEntriesBilled,
  recentPeriods,
  syncLalamoveUsage,
  totalsByOutlet,
  totalsByVendor,
  type VendorAccount,
  type VendorUsageEntry
} from '@/lib/vendorRecap';

type Outlet = { id: string; name: string };

const formatRp = (n: unknown) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const SOURCE_LABEL: Record<string, string> = {
  [VENDOR_SOURCE.MANUAL]: 'Manual',
  [VENDOR_SOURCE.N8N]: 'n8n',
  [VENDOR_SOURCE.INTERNAL]: 'Internal'
};

export default function RekapVendorPage() {
  const session = useMemo(() => getStaffSession(), []);
  const role = String(session.role || '').toLowerCase();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const [period, setPeriod] = useState(currentPeriod());
  const [vendorFilter, setVendorFilter] = useState('');
  const [accounts, setAccounts] = useState<VendorAccount[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [entries, setEntries] = useState<VendorUsageEntry[]>([]);

  const [formVendor, setFormVendor] = useState('');
  const [formOutlet, setFormOutlet] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formRef, setFormRef] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formQty, setFormQty] = useState('1');

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    if (!isAdminOpsRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    const [accs, { data: outs }] = await Promise.all([
      loadVendorAccounts(),
      supabase.from('outlets').select('id, name').order('name')
    ]);
    setAccounts(accs);
    setOutlets((outs as Outlet[]) || []);
    if (!formVendor && accs.length) setFormVendor(accs[0].vendor_key);
    setEntries(await loadUsageEntries({ period, vendorKey: vendorFilter || undefined, limit: 500 }));
    setLoading(false);
    // formVendor sengaja tidak jadi dependency: mengisi pilihan awal tidak boleh
    // memicu pemuatan ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, vendorFilter]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const outletName = useMemo(
    () => Object.fromEntries(outlets.map((o) => [o.id, o.name])),
    [outlets]
  );
  const vendorLabel = useCallback(
    (key: string) => accounts.find((a) => a.vendor_key === key)?.label || key,
    [accounts]
  );

  const byVendor = useMemo(() => totalsByVendor(entries), [entries]);
  const byOutlet = useMemo(() => totalsByOutlet(entries), [entries]);
  const unbilled = useMemo(() => entries.filter((e) => !isEntryBilled(e)), [entries]);
  const noTariff = useMemo(() => entries.filter((e) => !Number(e.amount)), [entries]);

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formVendor) return toast('Pilih vendor.', 'warn');
    setBusy('manual');
    const { error } = await addManualUsage({
      vendorKey: formVendor,
      outletId: formOutlet || null,
      usageDate: formDate,
      reference: formRef.trim(),
      amount: Number(formAmount) || 0,
      qty: Number(formQty) || 1,
      actorName: session.name
    });
    setBusy('');
    if (error) return toast(error.message, 'err');
    setFormRef('');
    setFormAmount('');
    toast('Pemakaian dicatat.', 'ok');
    load();
  };

  const handleSyncLalamove = async () => {
    setBusy('sync');
    const { synced, error } = await syncLalamoveUsage({ period, actorName: session.name });
    setBusy('');
    if (error) return toast(error.message, 'err');
    toast(
      synced
        ? `${synced} pengiriman Lalamove disalin. Tarif diisi saat tagihan tiba.`
        : 'Tidak ada pengiriman Lalamove baru di periode ini.',
      'ok'
    );
    if (synced) load();
  };

  const handleMarkBilled = async () => {
    if (!unbilled.length) return;
    const label = vendorFilter ? vendorLabel(vendorFilter) : 'semua vendor';
    if (!confirm(`Tandai ${unbilled.length} entri (${label}, ${period}) sebagai sudah ditagih?`)) return;
    setBusy('billed');
    const { error } = await markEntriesBilled(unbilled.map((e) => e.id), session.name);
    setBusy('');
    if (error) return toast(error.message, 'err');
    toast('Entri ditandai sudah ditagih.', 'ok');
    load();
  };

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;

  return (
    <div className="min-h-screen bg-[#f7f7f5] pb-20">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-bold text-slate-900">Rekap Pemakaian Vendor</h1>
            <p className="text-[11px] text-slate-500">
              {session.name} · periode {period}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/workspace"
              className="text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600"
            >
              Workspace
            </Link>
            <button
              type="button"
              onClick={() => downloadVendorRecapCsv(entries, outletName, `rekap_vendor_${period}`)}
              disabled={!entries.length}
              className="text-[11px] font-bold px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <section className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Periode</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
            >
              {recentPeriods(12).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Vendor</label>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
            >
              <option value="">Semua vendor</option>
              {accounts.map((a) => (
                <option key={a.vendor_key} value={a.vendor_key}>{a.label || a.vendor_key}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleSyncLalamove}
            disabled={busy === 'sync'}
            className="text-[11px] font-bold px-3 py-2 rounded-xl bg-orange-500 text-white disabled:opacity-50"
          >
            {busy === 'sync' ? 'Menyalin…' : 'Sinkron Lalamove'}
          </button>
          <button
            type="button"
            onClick={handleMarkBilled}
            disabled={busy === 'billed' || !unbilled.length}
            className="text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-300 text-slate-700 disabled:opacity-50"
          >
            Tandai sudah ditagih ({unbilled.length})
          </button>
        </section>

        <section className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[9px] uppercase font-bold text-slate-400">Total periode</p>
            <p className="text-lg font-bold text-slate-900">{formatRp(grandTotal(entries))}</p>
            <p className="text-[10px] text-slate-400">{entries.length} entri</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[9px] uppercase font-bold text-slate-400">Belum ditagih</p>
            <p className="text-lg font-bold text-amber-600">{formatRp(grandTotal(unbilled))}</p>
            <p className="text-[10px] text-slate-400">{unbilled.length} entri</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[9px] uppercase font-bold text-slate-400">Tarif belum diisi</p>
            <p className="text-lg font-bold text-slate-900">{noTariff.length}</p>
            <p className="text-[10px] text-slate-400">entri nominal 0</p>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Per Vendor</h2>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat…</p>
          ) : byVendor.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada pemakaian tercatat di periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wide">
                  <tr>
                    <th className="p-2.5">Vendor</th>
                    <th className="p-2.5 text-right">Entri</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right">Outlet</th>
                    <th className="p-2.5 text-right">Nominal</th>
                    <th className="p-2.5 text-right">Belum ditagih</th>
                  </tr>
                </thead>
                <tbody>
                  {byVendor.map((t) => (
                    <tr key={t.vendorKey} className="border-t border-slate-100">
                      <td className="p-2.5 font-bold text-slate-900">
                        {vendorLabel(t.vendorKey)}
                        {t.missingAmount > 0 && (
                          <span className="ml-2 text-[9px] font-bold text-amber-700">
                            {t.missingAmount} tanpa tarif
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-right">{t.entries}</td>
                      <td className="p-2.5 text-right">{t.qty}</td>
                      <td className="p-2.5 text-right">{t.outletCount || '—'}</td>
                      <td className="p-2.5 text-right font-black text-slate-900">{formatRp(t.amount)}</td>
                      <td className="p-2.5 text-right text-amber-700">{formatRp(t.unbilledAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Per Outlet</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Untuk membagi tagihan vendor ke outlet yang memakainya.
          </p>
          {byOutlet.length === 0 ? (
            <p className="text-xs text-slate-400">—</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {byOutlet.slice(0, 30).map((o) => (
                <li key={o.outletId} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {outletName[o.outletId] || o.outletId}
                  </span>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {o.entries} entri · <b className="text-slate-900">{formatRp(o.amount)}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Catat Pemakaian Manual</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Untuk vendor yang belum terintegrasi, mis. mCoin Smartlink. Lalamove sebaiknya lewat
            tombol sinkron agar tidak dobel.
          </p>
          <form onSubmit={handleAddManual} className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <select
              value={formVendor}
              onChange={(e) => setFormVendor(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
              required
            >
              <option value="">-- Vendor --</option>
              {accounts.map((a) => (
                <option key={a.vendor_key} value={a.vendor_key}>{a.label || a.vendor_key}</option>
              ))}
            </select>
            <select
              value={formOutlet}
              onChange={(e) => setFormOutlet(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white"
            >
              <option value="">Tanpa outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
              required
            />
            <input
              value={formRef}
              onChange={(e) => setFormRef(e.target.value)}
              placeholder="No. order / resi"
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <input
              type="number"
              min="0"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              placeholder="Nominal"
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
            />
            <input
              type="number"
              min="1"
              value={formQty}
              onChange={(e) => setFormQty(e.target.value)}
              placeholder="Qty"
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={busy === 'manual'}
              className="col-span-2 md:col-span-3 bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs disabled:opacity-50"
            >
              {busy === 'manual' ? 'Menyimpan…' : 'CATAT PEMAKAIAN'}
            </button>
          </form>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Entri Periode {period}</h2>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada entri.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wide">
                  <tr>
                    <th className="p-2.5">Tanggal</th>
                    <th className="p-2.5">Vendor</th>
                    <th className="p-2.5">Outlet</th>
                    <th className="p-2.5">Referensi</th>
                    <th className="p-2.5">Sumber</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right">Nominal</th>
                    <th className="p-2.5">Tagih</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 200).map((e) => (
                    <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="p-2.5 text-slate-500">{e.usage_date}</td>
                      <td className="p-2.5 text-slate-800">{vendorLabel(e.vendor_key)}</td>
                      <td className="p-2.5 text-slate-600">{outletName[String(e.outlet_id || '')] || '—'}</td>
                      <td className="p-2.5 text-slate-600">{e.reference || '—'}</td>
                      <td className="p-2.5 text-slate-400">{SOURCE_LABEL[String(e.source)] || e.source}</td>
                      <td className="p-2.5 text-right">{Number(e.qty) || 0}</td>
                      <td className="p-2.5 text-right font-bold text-slate-900">
                        {Number(e.amount) ? formatRp(e.amount) : <span className="text-amber-600">belum ada tarif</span>}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[9px] font-bold ${
                            isEntryBilled(e)
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {isEntryBilled(e) ? 'Sudah' : 'Belum'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
