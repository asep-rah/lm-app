'use client';

import { useEffect, useMemo, useState } from 'react';
import TransactionGrowthModal from '@/components/analytics/TransactionGrowthModal';
import { idr, type CopilotInsight, type CopilotMetrics, type CopilotPeriod } from '@/lib/aiCopilotAnalytics';

type Props = {
  scope?: 'owner' | 'supervisor';
  outletId?: string;
  period?: CopilotPeriod | string;
  supervisorName?: string;
  accessOutlets?: unknown;
};

export default function AICopilotCard({
  scope = 'owner',
  outletId = 'ALL',
  period = 'THIS_MONTH',
  supervisorName,
  accessOutlets
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [insights, setInsights] = useState<CopilotInsight[]>([]);
  const [metrics, setMetrics] = useState<Partial<CopilotMetrics> | null>(null);
  const [open, setOpen] = useState(false);

  const payload = useMemo(
    () => ({
      scope,
      outletId,
      period,
      supervisorName,
      accessOutlets
    }),
    [scope, outletId, period, supervisorName, JSON.stringify(accessOutlets || null)]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/ai/copilot-analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        setSummary(json.summary || '');
        setInsights(Array.isArray(json.insights) ? json.insights : []);
        setMetrics(json.metrics || null);
      } catch {
        if (!cancelled) {
          setSummary('Analitik belum tersedia. Coba muat ulang.');
          setInsights([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <>
      <section className="bg-slate-900 text-white rounded-2xl p-4 md:p-5 shadow-sm border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">AI Copilot Analytics</p>
            <h3 className="text-base font-black mt-0.5">
              {scope === 'supervisor' ? 'Performa cabang pengawasan' : 'Ringkasan otomatis Owner'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Insight performa, efisiensi OPEX, skor SLA, plus analisa omset.
            </p>
          </div>
          <div className="flex gap-2 text-center">
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 min-w-[92px]">
              <p className="text-[9px] uppercase font-bold text-slate-400">Omset</p>
              <p className="text-xs font-black tabular-nums">{idr(metrics?.grossRevenue || 0)}</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 min-w-[72px]">
              <p className="text-[9px] uppercase font-bold text-slate-400">SLA</p>
              <p className="text-lg font-black tabular-nums">{metrics?.slaScore ?? '—'}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">Menyusun insight…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {insights.map((ins) => (
              <article
                key={ins.title}
                className={`rounded-xl px-3 py-2.5 border ${
                  ins.tone === 'warn'
                    ? 'bg-amber-500/10 border-amber-400/30'
                    : ins.tone === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-400/20'
                      : 'bg-white/5 border-white/10'
                }`}
              >
                <p className="text-[10px] font-bold uppercase text-slate-300">{ins.title}</p>
                <p className="text-[11px] text-slate-100 mt-1 leading-relaxed">{ins.body}</p>
              </article>
            ))}
          </div>
        )}

        {summary && !loading && <p className="text-[11px] text-slate-300 leading-relaxed">{summary}</p>}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs md:text-sm py-3 rounded-xl shadow"
        >
          🚀 Analisa Transaksi & Peningkatan Omset
        </button>
      </section>

      <TransactionGrowthModal open={open} onClose={() => setOpen(false)} payload={payload} />
    </>
  );
}
