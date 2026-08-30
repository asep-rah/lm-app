'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { getStaffSession } from '@/lib/staffSession';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  analyseRecon,
  applyReconAdjustment,
  escalateLeakageToSupervisor,
  leakageTypeLabel,
  money,
  reconStatusLabel,
  resolveLeakageAlert,
  runFinanceReconEngine,
  type DailyReconRow
} from '@/lib/financeRecon';

const statusTone = (status: string) => {
  if (status === 'MATCHED') return 'emerald' as const;
  if (status === 'DISCREPANCY_ALERT') return 'rose' as const;
  return 'amber' as const;
};

const sevTone = (s: string) => {
  if (s === 'CRITICAL') return 'rose' as const;
  if (s === 'HIGH') return 'amber' as const;
  return 'slate' as const;
};

export default function FinanceReconBoard({ embedded = false }: { embedded?: boolean }) {
  const session = getStaffSession();
  const [rows, setRows] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'open'>('open');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [cashAdj, setCashAdj] = useState('');
  const [qrisAdj, setQrisAdj] = useState('');

  const names = useMemo(
    () => Object.fromEntries(outlets.map((o) => [o.id, o.name])),
    [outlets]
  );

  const load = async () => {
    const [{ data: outs }, { data: recon }, { data: leak }] = await Promise.all([
      supabase.from('outlets').select('id, name').order('name'),
      supabase.from('daily_reconciliations').select('*').order('date', { ascending: false }).limit(120),
      supabase
        .from('financial_leakage_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(80)
    ]);
    setOutlets(outs || []);
    setRows(recon || []);
    setAlerts(leak || []);
  };

  useEffect(() => {
    load();
  }, []);

  const visible = rows.filter((r) => (filter === 'open' ? r.status !== 'MATCHED' : true));
  const relatedAlerts = (row: any) =>
    alerts.filter(
      (a) =>
        !a.is_resolved &&
        String(a.outlet_id || '') === String(row.outlet_id || '') &&
        String(a.analysis_reason || '').includes(`[${row.date}`)
    );

  const runNow = async () => {
    setBusy(true);
    try {
      const api = await fetch('/api/cron/reconcile-finance?days=3', { method: 'POST' });
      if (api.ok) {
        const json = await api.json();
        toast(`Rekonsiliasi selesai. ${json.reconUpserts || 0} hari · ${json.alertsCreated || 0} alert baru.`, 'ok');
      } else {
        const local = await runFinanceReconEngine(supabase, { days: 3 });
        if (!local.ok && local.reconUpserts === 0) {
          toast(local.error || 'Gagal menjalankan rekonsiliasi. Terapkan migrasi SQL dulu.', 'err');
        } else {
          toast(`Rekonsiliasi lokal: ${local.reconUpserts} hari · ${local.alertsCreated} alert.`, local.ok ? 'ok' : 'warn');
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openRow = (row: any) => {
    setSelected(row);
    setCashAdj(String(row.reported_cash_deposit ?? ''));
    setQrisAdj(String(row.gateway_qris_settlement ?? ''));
  };

  const matchToSystem = async () => {
    if (!selected?.id) return;
    setBusy(true);
    const { error, row } = await applyReconAdjustment(selected as DailyReconRow & { id: string }, {
      reported_cash_deposit: Number(selected.system_cash_total) || 0,
      gateway_qris_settlement: Number(selected.system_qris_total) || 0
    });
    setBusy(false);
    if (error) return toast(error.message, 'err');
    toast('Penyesuaian manual: angka setoran/gateway disamakan ke sistem.', 'ok');
    setSelected(row);
    await load();
  };

  const saveAdjust = async () => {
    if (!selected?.id) return;
    setBusy(true);
    const { error, row } = await applyReconAdjustment(selected as DailyReconRow & { id: string }, {
      reported_cash_deposit: Number(cashAdj) || 0,
      gateway_qris_settlement: Number(qrisAdj) || 0
    });
    setBusy(false);
    if (error) return toast(error.message, 'err');
    toast(`Status menjadi ${reconStatusLabel(row.status)}.`, row.status === 'MATCHED' ? 'ok' : 'warn');
    setSelected({ ...selected, ...row });
    await load();
  };

  const escalate = async () => {
    if (!selected) return;
    const name = names[selected.outlet_id] || 'Outlet';
    setBusy(true);
    const { error } = await escalateLeakageToSupervisor({
      outletName: name,
      outletId: selected.outlet_id,
      amount: Math.max(Math.abs(Number(selected.cash_discrepancy) || 0), Math.abs(Number(selected.qris_discrepancy) || 0)),
      reason: analyseRecon(selected, name)
    });
    setBusy(false);
    if (error) return toast(error.message, 'err');
    toast('Eskalasi terkirim ke inbox Supervisor.', 'ok');
  };

  const resolveAlert = async (id: string) => {
    setBusy(true);
    const { error } = await resolveLeakageAlert(id, session.id);
    setBusy(false);
    if (error) return toast(error.message, 'err');
    toast('Alert ditandai selesai.', 'ok');
    await load();
  };

  return (
    <div className="space-y-3">
      {!embedded && (
        <div>
          <h3 className="text-sm font-black text-slate-900">Auto-Reconciliation & Audit Board</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Cocokkan kas POS vs setoran kasir, QRIS vs webhook Mayar, plus flag void / diskon / setoran telat.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          disabled={busy}
          onClick={runNow}
          className="text-[11px] font-bold px-3 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
        >
          {busy ? 'Memproses…' : 'Jalankan rekonsiliasi'}
        </button>
        <button
          type="button"
          onClick={() => setFilter(filter === 'open' ? 'all' : 'open')}
          className="text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200"
        >
          {filter === 'open' ? 'Tampil: Unmatched' : 'Tampil: Semua'}
        </button>
        <button type="button" onClick={load} className="text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200">
          Muat ulang
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-100 rounded-xl">
        <table className="w-full text-left text-[11px] whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[9px]">
            <tr>
              <th className="p-2">Tanggal</th>
              <th className="p-2">Outlet</th>
              <th className="p-2 text-right">Kas sistem</th>
              <th className="p-2 text-right">Setoran</th>
              <th className="p-2 text-right">Selisih kas</th>
              <th className="p-2 text-right">QRIS</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                onClick={() => openRow(r)}
                className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
              >
                <td className="p-2 font-mono">{r.date}</td>
                <td className="p-2 font-bold">{names[r.outlet_id] || '—'}</td>
                <td className="p-2 text-right">{money(r.system_cash_total)}</td>
                <td className="p-2 text-right">{money(r.reported_cash_deposit)}</td>
                <td className={`p-2 text-right font-bold ${Math.abs(Number(r.cash_discrepancy) || 0) > 1 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {money(r.cash_discrepancy)}
                </td>
                <td className="p-2 text-right">{money(r.qris_discrepancy)}</td>
                <td className="p-2">
                  <StatusBadge tone={statusTone(r.status)}>{reconStatusLabel(r.status)}</StatusBadge>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-400">
                  {rows.length === 0
                    ? 'Belum ada log. Jalankan rekonsiliasi atau terapkan migrasi SQL.'
                    : 'Semua hari sudah matched.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {alerts.some((a) => !a.is_resolved) && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase text-slate-400">Alert kebocoran terbuka</p>
          {alerts
            .filter((a) => !a.is_resolved)
            .slice(0, 8)
            .map((a) => (
              <div key={a.id} className="border border-slate-100 rounded-xl px-2.5 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StatusBadge tone={sevTone(a.severity)}>{a.severity}</StatusBadge>
                    <span className="text-[11px] font-bold">{leakageTypeLabel(a.alert_type)}</span>
                    <span className="text-[11px] text-slate-500">{money(a.leakage_amount)}</span>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">{a.analysis_reason}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolveAlert(a.id)}
                  className="text-[10px] font-bold text-emerald-700 shrink-0"
                >
                  Selesai
                </button>
              </div>
            ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end md:items-center justify-center p-3" onClick={() => setSelected(null)}>
          <div
            className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-4 shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Analisa Penyebab Kebocoran</p>
                <h4 className="text-sm font-black text-slate-900">
                  {names[selected.outlet_id] || 'Outlet'} · {selected.date}
                </h4>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-xs font-bold text-slate-400">
                Tutup
              </button>
            </div>
            <StatusBadge tone={statusTone(selected.status)}>{reconStatusLabel(selected.status)}</StatusBadge>
            <p className="text-xs text-slate-700 leading-relaxed">
              {analyseRecon(selected, names[selected.outlet_id] || 'Outlet')}
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-slate-100 p-2">
                <p className="text-[9px] uppercase font-bold text-slate-400">Kas sistem</p>
                <p className="font-black">{money(selected.system_cash_total)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 p-2">
                <p className="text-[9px] uppercase font-bold text-slate-400">Setoran kasir</p>
                <p className="font-black">{money(selected.reported_cash_deposit)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 p-2">
                <p className="text-[9px] uppercase font-bold text-slate-400">QRIS sistem</p>
                <p className="font-black">{money(selected.system_qris_total)}</p>
              </div>
              <div className="rounded-xl border border-slate-100 p-2">
                <p className="text-[9px] uppercase font-bold text-slate-400">Settlement gateway</p>
                <p className="font-black">{money(selected.gateway_qris_settlement)}</p>
              </div>
            </div>

            {relatedAlerts(selected).map((a) => (
              <p key={a.id} className="text-[11px] bg-rose-50 border border-rose-100 rounded-xl px-2.5 py-2">
                {leakageTypeLabel(a.alert_type)} · {a.severity}: {a.analysis_reason}
              </p>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Revisi setoran tunai</label>
                <input
                  type="number"
                  value={cashAdj}
                  onChange={(e) => setCashAdj(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-1">Revisi settlement QRIS</label>
                <input
                  type="number"
                  value={qrisAdj}
                  onChange={(e) => setQrisAdj(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={saveAdjust}
                className="text-[11px] font-bold py-2.5 rounded-xl bg-slate-900 text-white"
              >
                Simpan revisi
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={matchToSystem}
                className="text-[11px] font-bold py-2.5 rounded-xl bg-emerald-600 text-white"
              >
                Samakan ke sistem
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={escalate}
                className="text-[11px] font-bold py-2.5 rounded-xl border border-amber-300 text-amber-800 bg-amber-50"
              >
                Eskalasi Supervisor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
