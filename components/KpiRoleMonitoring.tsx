'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchRoleKpis, type KpiCard } from '@/lib/kpiMetrics';
import { currentMonthYear } from '@/lib/kpiCatalog';
import { getStaffSession, kpiKeysVisibleForRole, canAccessSettings } from '@/lib/staffSession';
import Skeleton from '@/components/ui/Skeleton';
import StatusBadge from '@/components/ui/StatusBadge';

const toneOf = (score: number) =>
  score >= 90 ? 'emerald' : score >= 70 ? 'amber' : 'rose';

export default function KpiRoleMonitoring() {
  const session = useMemo(() => getStaffSession(), []);
  const allowedKeys = kpiKeysVisibleForRole(session.role);
  const canEditTargets = canAccessSettings(session.role);

  const [cards, setCards] = useState<KpiCard[]>([]);
  const [healthyCount, setHealthyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState('');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [fromConfig, setFromConfig] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchRoleKpis(monthYear);
      const visible = allowedKeys
        ? res.cards.filter((c) => allowedKeys.includes(c.roleKey))
        : res.cards;
      setCards(visible);
      setHealthyCount(visible.filter((c) => c.healthy).length);
      setFromConfig(res.fromConfig);
      setLastSynced(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('KPI fetch gagal:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthYear, session.role]);

  const allHealthy = healthyCount === cards.length && cards.length > 0;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-all">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900">
            {allowedKeys === null ? 'Monitoring KPI 7 Role' : 'KPI Role Anda'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Skor = realisasi vs target {monthYear}
            {fromConfig ? ' · kpi_configs' : ' · katalog default'}
            {lastSynced ? ` · sync ${lastSynced}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={monthYear}
            onChange={(e) => setMonthYear(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-[10px] rounded-lg px-2 py-1.5"
          />
          {canEditTargets && (
            <Link
              href="/owner/kpi-settings"
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-sky-500 text-white hover:bg-sky-600"
            >
              Atur Target
            </Link>
          )}
          <StatusBadge tone={loading ? 'slate' : allHealthy ? 'emerald' : 'amber'}>
            {loading ? 'Memuat…' : allHealthy ? 'On Target' : `${healthyCount}/${cards.length} Role`}
          </StatusBadge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {(cards.length ? cards : Array.from({ length: allowedKeys?.length || 1 })).map((item: any, idx) => (
          <div
            key={item?.roleKey || idx}
            className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 hover:shadow-sm transition-all"
          >
            {loading && !cards.length ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-3 w-full" />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-2 gap-2">
                  <span className="font-bold text-slate-900 text-sm truncate">{item.role}</span>
                  <StatusBadge tone={toneOf(item.score) as any}>{item.score}%</StatusBadge>
                </div>
                <p className="text-base font-black text-slate-900 mt-1">{item.val}</p>
                <div className="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(100, item.score || 0)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{item.desc}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
