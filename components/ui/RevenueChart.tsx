'use client';

export type ChartPoint = { label: string; value: number };

export default function RevenueChart({ points }: { points: ChartPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 560;
  const h = 180;
  const pad = 16;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const coords = points.map((p, i) => {
    const x = pad + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = pad + innerH - (p.value / max) * innerH;
    return `${x},${y}`;
  });
  const area = `${pad},${pad + innerH} ${coords.join(' ')} ${pad + innerW},${pad + innerH}`;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">Revenue Trend</h3>
          <p className="text-[11px] text-slate-400">Omset harian 14 hari terakhir</p>
        </div>
      </div>
      {points.every((p) => !p.value) ? (
        <p className="text-xs text-slate-400 py-10 text-center">Belum ada omset pada jendela ini.</p>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44">
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#revFill)" />
          <polyline
            points={coords.join(' ')}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}
      <div className="flex justify-between text-[10px] text-slate-400 font-medium">
        {points.filter((_, i) => i % Math.ceil(points.length / 7) === 0).map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}
