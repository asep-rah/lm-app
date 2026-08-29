'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import OwnerExecNav from '@/components/OwnerExecNav';
import { fetchRoleKpis, type KpiCard, type KpiMetricLine } from '@/lib/kpiMetrics';
import { currentMonthYear } from '@/lib/kpiCatalog';
import { canAccessSettings, canAccessKpiSettings, homePathForRole, isOwnerRole, isWorkspaceRole, kpiKeysVisibleForRole } from '@/lib/staffSession';
import StatusBadge from '@/components/ui/StatusBadge';

const fmtHours = (h: number) => {
  if (!h || !isFinite(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} mnt`;
  return `${h.toFixed(1)} jam`;
};

const metricOf = (card: KpiCard, pred: (m: KpiMetricLine) => boolean) => card.metrics.find(pred);

const processAvgOf = (card: KpiCard) => {
  const m = metricOf(card, (x) => /hours|process|speed|exec|reply/.test(x.key));
  if (!m) return '—';
  if (m.unit === 'jam' || /hours|process|speed|exec|reply/.test(m.key)) return fmtHours(Number(m.actual) || 0);
  return `${m.actual}${m.unit ? ` ${m.unit}` : ''}`;
};

const slaStatusOf = (card: KpiCard) => {
  if (card.penalty > 0) return { label: 'Overdue', tone: 'rose' as const };
  const sla = metricOf(card, (x) => /sla/.test(x.key));
  if (sla) {
    const pct = Number(sla.actual) || 0;
    if (pct >= 95) return { label: `On Time ${pct}%`, tone: 'emerald' as const };
    if (pct >= 80) return { label: `At Risk ${pct}%`, tone: 'amber' as const };
    return { label: `Miss ${pct}%`, tone: 'rose' as const };
  }
  return card.healthy
    ? { label: 'On Target', tone: 'emerald' as const }
    : { label: 'Perlu perhatian', tone: 'amber' as const };
};

const csatOf = (card: KpiCard) => {
  const m = metricOf(card, (x) => /csat|rating/.test(x.key));
  if (m && Number(m.actual) > 0) return `★ ${Number(m.actual).toFixed(1)}`;
  if (card.roleKey === 'owner_relation' && /CSAT|⭐/.test(card.val)) return card.val;
  return '—';
};

const targetDetailOf = (card: KpiCard) => {
  if (!card.metrics.length) return card.desc || '—';
  return card.metrics
    .map((m) => `${m.label}: ${m.actual}/${m.target}${m.unit ? ` ${m.unit}` : ''}`)
    .join(' · ');
};

export default function OwnerKpiPage() {
  const [ready, setReady] = useState(false);
  const [canEditTargets, setCanEditTargets] = useState(false);
  const [viewerRole, setViewerRole] = useState('');
  const [cards, setCards] = useState<KpiCard[]>([]);
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = String(JSON.parse(raw).role || '').toLowerCase();
    if (isWorkspaceRole(role) && !canAccessSettings(role)) {
      window.location.href = '/workspace';
      return;
    }
    if (!canAccessSettings(role) && !isOwnerRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setCanEditTargets(canAccessKpiSettings(role));
    setViewerRole(role);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    fetchRoleKpis(monthYear)
      .then((res) => {
        if (!cancelled) {
          const allowed = kpiKeysVisibleForRole(viewerRole);
          setCards(allowed ? res.cards.filter((c) => allowed.includes(c.roleKey)) : res.cards);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, monthYear, viewerRole]);

  const healthy = useMemo(() => cards.filter((c) => c.healthy).length, [cards]);

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white border border-slate-200/80 p-5 md:p-6 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Owner Analytics</p>
            <h1 className="text-2xl font-black text-slate-900 mt-0.5">Pencapaian KPI</h1>
            <p className="text-xs text-slate-400 mt-0.5">Capaian vs target per divisi · {monthYear}</p>
          </div>
          <div className="flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto">
            <OwnerExecNav active="kpi" />
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={monthYear}
                onChange={(e) => setMonthYear(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1.5"
              />
              {canEditTargets && (
                <Link href="/owner/kpi-settings" className="text-xs font-bold px-3 py-1.5 rounded-lg bg-sky-500 text-white">
                  Atur Target
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
            <p className="text-xs font-bold text-slate-500">{healthy}/{cards.length || 0} role on target</p>
            {loading && <p className="text-[10px] text-slate-400">Memuat…</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Role / Divisi</th>
                  <th className="p-3">Capaian %</th>
                  <th className="p-3">Proses Avg</th>
                  <th className="p-3">SLA Status</th>
                  <th className="p-3">CSAT / Rating</th>
                  <th className="p-3">Detail Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(cards.length ? cards : Array.from({ length: Math.max(1, kpiKeysVisibleForRole(viewerRole)?.length || 7) })).map((card: any, i) => {
                  const sla = card?.roleKey ? slaStatusOf(card) : null;
                  return (
                    <tr key={card?.roleKey || i} className="hover:bg-slate-50">
                      <td className="p-3 font-black text-slate-900">{card?.role || '—'}</td>
                      <td className="p-3">
                        {card?.score != null ? (
                          <span className={`font-black ${card.score >= 90 ? 'text-emerald-600' : card.score >= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
                            {card.score}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 font-semibold text-slate-700">{card?.roleKey ? processAvgOf(card) : '—'}</td>
                      <td className="p-3">
                        {sla ? <StatusBadge tone={sla.tone}>{sla.label}</StatusBadge> : '—'}
                      </td>
                      <td className="p-3 font-bold text-slate-800">{card?.roleKey ? csatOf(card) : '—'}</td>
                      <td className="p-3 text-[11px] text-slate-500 font-medium max-w-md whitespace-normal">
                        {card?.roleKey ? targetDetailOf(card) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
