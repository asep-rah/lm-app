export default function MetricCard({
  label,
  value,
  hint,
  trend,
  accent = 'sky'
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: number | null;
  accent?: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const bar: Record<string, string> = {
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500'
  };
  const up = (trend ?? 0) >= 0;
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <span className={`h-1.5 w-8 rounded-full ${bar[accent]}`} />
      </div>
      <p className="mt-2 text-2xl md:text-3xl font-black tracking-tight text-slate-900">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {trend !== null && trend !== undefined && Number.isFinite(trend) && (
          <span
            className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${
              up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {up ? '▲' : '▼'} {Math.abs(Math.round(trend))}%
          </span>
        )}
        {hint && <p className="text-[11px] text-slate-400 truncate">{hint}</p>}
      </div>
    </div>
  );
}
