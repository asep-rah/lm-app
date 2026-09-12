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

type ReconMeta = {
  total: number;
  unmatched: number;
  matched: number;
  lastCheckedAt: string | null;
  lastDate: string | null;
  loading: boolean;
  loadError: boolean;
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
  const [meta, setMeta] = useState<ReconMeta>({
    total: 0,
    unmatched: 0,
    matched: 0,
    lastCheckedAt: null,
    lastDate: null,
    loading: true,
    loadError: false
  });
  const [boardOpen, setBoardOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>(outletNames || {});
  const openBoard = onOpenBoard || (enableBoard ? () => setBoardOpen(true) : undefined);

  const loadOpen = async () => {
    setMeta((m) => ({ ...m, loading: true, loadError: false }));
    const [{ data: alerts, error: alertErr }, { data: recons, error: reconErr }] = await Promise.all([
      supabase
        .from('financial_leakage_alerts')
        .select('id, outlet_id, alert_type, severity, leakage_amount, analysis_reason, is_resolved')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('daily_reconciliations')
        .select('id, status, date, created_at, updated_at')
        .order('date', { ascending: false })
        .limit(120)
    ]);

    if (alertErr || reconErr) {
      setBanners([]);
      setMeta({
        total: 0,
        unmatched: 0,
        matched: 0,
        lastCheckedAt: null,
        lastDate: null,
        loading: false,
        loadError: true
      });
      return;
    }

    const rows = recons || [];
    const unmatched = rows.filter((r: any) => r.status === 'DISCREPANCY_ALERT').length;
    const matched = rows.filter((r: any) => r.status === 'MATCHED').length;
    let lastCheckedAt: string | null = null;
    let lastDate: string | null = null;
    for (const r of rows as any[]) {
      const ts = r.updated_at || r.created_at || null;
      if (ts && (!lastCheckedAt || String(ts) > lastCheckedAt)) lastCheckedAt = String(ts);
      if (r.date && (!lastDate || String(r.date) > lastDate)) lastDate = String(r.date);
    }

    setBanners(alerts || []);
    setMeta({
      total: rows.length,
      unmatched,
      matched,
      lastCheckedAt,
      lastDate,
      loading: false,
      loadError: false
    });

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_deposits' }, (payload) => {
        const row = payload.new as {
          status?: string;
          status_qris?: string;
          qr_payment_status?: string;
          amount_cash?: number;
          net_deposit_amount?: number;
          outlet_id?: string;
        };
        const st = String(row?.status || '').toUpperCase();
        const qris = String(row?.status_qris || row?.qr_payment_status || '').toLowerCase();
        const nowBalanced = st === 'BALANCED' || qris === 'success';
        const was = payload.old as { status?: string } | null;
        if (nowBalanced && String(was?.status || '').toUpperCase() !== 'BALANCED') {
          const name = names[String(row.outlet_id || '')] || 'Outlet';
          notifyOps(
            'payment',
            `Setoran kasir ${name} terverifikasi otomatis · Rp ${Number(row.net_deposit_amount || row.amount_cash || 0).toLocaleString('id-ID')} (BALANCED)`,
            true,
            openBoard ? { onClick: openBoard } : undefined
          );
        }
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
            `Selisih rekonsiliasi · ${name} · ${analyseRecon(row, name)}`,
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
  const neverRun = !meta.loading && !meta.loadError && meta.total === 0;
  const hasGaps = meta.unmatched > 0 || banners.length > 0;
  const hot = Boolean(critical.length || meta.unmatched);

  let statusTitle = 'Rekonsiliasi keuangan';
  let statusBody = '';
  let tone: 'rose' | 'amber' | 'slate' | 'emerald' = 'slate';

  if (meta.loading) {
    statusBody = 'Memuat status rekonsiliasi…';
    tone = 'slate';
  } else if (meta.loadError) {
    statusTitle = 'Status rekonsiliasi tidak tersedia';
    statusBody =
      'Data rekonsiliasi belum bisa dibaca. Buka Audit Board untuk mencoba lagi atau hubungi admin sistem.';
    tone = 'amber';
  } else if (top) {
    statusTitle = 'Alert keuangan terbuka';
    statusBody = `${name} · ${leakageTypeLabel(top.alert_type)} · ${money(Number(top.leakage_amount) || 0)}`;
    tone = 'rose';
  } else if (meta.unmatched > 0) {
    statusTitle = 'Ada selisih rekonsiliasi';
    statusBody = `${meta.unmatched} hari/outlet belum cocok (unmatched). Periksa Audit Board sebelum menutup kas.`;
    tone = 'rose';
  } else if (neverRun) {
    statusTitle = 'Rekonsiliasi belum dijalankan';
    statusBody =
      'Belum ada log pemeriksaan. Nol alert di sini tidak berarti kas/QRIS sudah aman — jalankan rekonsiliasi terlebih dahulu.';
    tone = 'amber';
  } else {
    statusTitle = 'Selesai tanpa selisih terbuka';
    statusBody = `${meta.matched} hari tercatat cocok (matched). Tidak ada alert kebocoran terbuka saat ini.`;
    tone = 'emerald';
  }

  const shell =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : tone === 'emerald'
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-slate-200 bg-white';

  const titleCls =
    tone === 'rose'
      ? 'text-rose-700'
      : tone === 'amber'
        ? 'text-amber-800'
        : tone === 'emerald'
          ? 'text-emerald-800'
          : 'text-slate-400';

  const bodyCls =
    tone === 'rose'
      ? 'text-rose-900'
      : tone === 'amber'
        ? 'text-amber-950'
        : tone === 'emerald'
          ? 'text-emerald-950'
          : 'text-slate-700';

  const metaCls =
    tone === 'rose'
      ? 'text-rose-600'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'emerald'
          ? 'text-emerald-700'
          : 'text-slate-400';

  return (
    <div className={`rounded-2xl border px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${shell}`}>
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] font-black uppercase tracking-wide ${titleCls}`}>{statusTitle}</p>
        <p className={`text-xs font-semibold leading-snug mt-0.5 ${bodyCls}`}>{statusBody}</p>
        {top?.analysis_reason && (
          <p className={`text-[11px] mt-0.5 leading-relaxed ${metaCls}`}>{top.analysis_reason}</p>
        )}
        <p className={`text-[10px] mt-1 ${metaCls}`}>
          {meta.loading
            ? '…'
            : neverRun
              ? '0 log · belum diperiksa'
              : `${banners.length} alert terbuka · ${meta.unmatched} unmatched · ${meta.total} hari diperiksa`}
          {meta.lastCheckedAt
            ? ` · dicek ${new Date(meta.lastCheckedAt).toLocaleString('id-ID', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              })}`
            : meta.lastDate
              ? ` · data terakhir ${meta.lastDate}`
              : ''}
        </p>
        {neverRun && (
          <p className={`text-[10px] mt-1 font-medium ${metaCls}`}>
            Langkah berikutnya: buka Audit Board → Jalankan rekonsiliasi.
          </p>
        )}
      </div>
      {openBoard && (
        <button
          type="button"
          onClick={openBoard}
          className={`shrink-0 text-[11px] font-bold px-3 py-2.5 min-h-[44px] rounded-xl text-white ${
            hot || neverRun ? 'bg-rose-700' : 'bg-slate-800'
          }`}
          aria-label="Buka Audit Board rekonsiliasi keuangan"
        >
          {neverRun ? 'Jalankan di Audit Board' : hasGaps ? 'Buka Audit Board' : 'Lihat Audit Board'}
        </button>
      )}
      {boardOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/40 flex items-end md:items-center justify-center p-3"
          onClick={() => setBoardOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Audit Board rekonsiliasi"
        >
          <div
            className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setBoardOpen(false)}
                className="text-xs font-bold text-slate-500 px-3 py-2 min-h-[44px]"
              >
                Tutup
              </button>
            </div>
            <FinanceReconBoard onChanged={loadOpen} embedded />
          </div>
        </div>
      )}
    </div>
  );
}
