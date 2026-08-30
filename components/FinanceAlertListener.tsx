'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { notifyOps } from '@/lib/opsNotify';
import { leakageTypeLabel, money, analyseRecon, type DailyReconRow } from '@/lib/financeRecon';
import FinanceReconBoard from '@/components/FinanceReconBoard';

type AlertRow = {
  id: string;
  outlet_id?: string | null;
  alert_type: string;
  severity: string;
  leakage_amount?: number;
  analysis_reason?: string;
  is_resolved?: boolean;
};

export default function FinanceAlertListener({
  outletNames,
  onOpenBoard,
  enableBoard = true
}: {
  outletNames?: Record<string, string>;
  onOpenBoard?: () => void;
  enableBoard?: boolean;
}) {
  const [banners, setBanners] = useState<AlertRow[]>([]);
  const [discCount, setDiscCount] = useState(0);
  const [boardOpen, setBoardOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>(outletNames || {});
  const openBoard = onOpenBoard || (enableBoard ? () => setBoardOpen(true) : undefined);

  const loadOpen = async () => {
    const [{ data: alerts }, { data: recons }] = await Promise.all([
      supabase
        .from('financial_leakage_alerts')
        .select('id, outlet_id, alert_type, severity, leakage_amount, analysis_reason, is_resolved')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('daily_reconciliations')
        .select('id, status')
        .eq('status', 'DISCREPANCY_ALERT')
        .limit(80)
    ]);
    setBanners(alerts || []);
    setDiscCount((recons || []).length);
    if (!outletNames) {
      const { data: outs } = await supabase.from('outlets').select('id, name');
      setNames(Object.fromEntries((outs || []).map((o: any) => [o.id, o.name])));
    }
  };

  useEffect(() => {
    loadOpen();
    const channel = supabase
      .channel('finance_leakage_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financial_leakage_alerts' }, (payload) => {
        const row = payload.new as AlertRow;
        if (row.is_resolved) return;
        notifyOps(
          'payment',
          row.analysis_reason ||
            `Alert ${row.severity}: ${leakageTypeLabel(row.alert_type)} · ${money(Number(row.leakage_amount) || 0)}`,
          true,
          openBoard ? { onClick: openBoard } : undefined
        );
        loadOpen();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_reconciliations' }, (payload) => {
        const row = payload.new as DailyReconRow;
        const prev = (payload.old as { status?: string } | null)?.status;
        const becameAlert =
          row?.status === 'DISCREPANCY_ALERT' &&
          (payload.eventType === 'INSERT' || prev !== 'DISCREPANCY_ALERT');
        if (becameAlert) {
          const name = names[String(row.outlet_id || '')] || outletNames?.[String(row.outlet_id || '')] || 'Outlet';
          notifyOps(
            'payment',
            `DISCREPANCY_ALERT · ${name} · ${analyseRecon(row, name)}`,
            true,
            openBoard ? { onClick: openBoard } : undefined
          );
        }
        loadOpen();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const critical = banners.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH');
  const top = critical[0] || banners[0];
  const name = names[String(top?.outlet_id || '')] || 'Outlet';
  const hot = Boolean(critical.length || discCount);

  return (
    <div
      className={`rounded-2xl border px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${
        hot ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] font-black uppercase tracking-wide ${hot ? 'text-rose-700' : 'text-slate-400'}`}>
          {hot ? 'Critical Financial Alert' : 'Rekonsiliasi Keuangan'}
        </p>
        <p className={`text-xs font-semibold leading-snug mt-0.5 ${hot ? 'text-rose-900' : 'text-slate-700'}`}>
          {top
            ? `${name} · ${leakageTypeLabel(top.alert_type)} · ${money(Number(top.leakage_amount) || 0)}`
            : discCount
              ? `${discCount} hari outlet unmatched`
              : 'Kas & QRIS belum ada alert terbuka.'}
        </p>
        {top?.analysis_reason && (
          <p className={`text-[11px] mt-0.5 leading-relaxed ${hot ? 'text-rose-800/90' : 'text-slate-500'}`}>{top.analysis_reason}</p>
        )}
        <p className={`text-[10px] mt-1 ${hot ? 'text-rose-600' : 'text-slate-400'}`}>
          {banners.length} alert terbuka · {discCount} rekonsiliasi unmatched
        </p>
      </div>
      {openBoard && (
        <button
          type="button"
          onClick={openBoard}
          className="shrink-0 text-[11px] font-bold px-3 py-2 rounded-xl bg-rose-700 text-white"
        >
          Buka Audit Board
        </button>
      )}
      {boardOpen && (
        <div className="fixed inset-0 z-[55] bg-black/40 flex items-end md:items-center justify-center p-3" onClick={() => setBoardOpen(false)}>
          <div
            className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-2">
              <button type="button" onClick={() => setBoardOpen(false)} className="text-xs font-bold text-slate-400">
                Tutup
              </button>
            </div>
            <FinanceReconBoard />
          </div>
        </div>
      )}
    </div>
  );
}
