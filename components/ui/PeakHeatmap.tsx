'use client';

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const SLOTS = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];

export default function PeakHeatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
      <div className="mb-3">
        <h3 className="text-sm font-black text-slate-900">Peak Hours Activity</h3>
        <p className="text-[11px] text-slate-400">Heatmap transaksi per jam (strategi shift outlet)</p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          <div className="grid grid-cols-[36px_repeat(12,minmax(0,1fr))] gap-1 mb-1">
            <span />
            {SLOTS.map((s) => (
              <span key={s} className="text-[9px] text-slate-400 text-center font-bold">
                {s}
              </span>
            ))}
          </div>
          {DAYS.map((day, di) => (
            <div key={day} className="grid grid-cols-[36px_repeat(12,minmax(0,1fr))] gap-1 mb-1">
              <span className="text-[10px] text-slate-500 font-bold self-center">{day}</span>
              {SLOTS.map((_, si) => {
                const n = grid[di]?.[si] || 0;
                const t = n / max;
                return (
                  <div
                    key={day + si}
                    title={`${day} ${SLOTS[si]}:00 · ${n} trx`}
                    className="h-6 rounded-md border border-slate-100"
                    style={{
                      backgroundColor:
                        n === 0 ? '#f8fafc' : `rgba(16, 185, 129, ${0.12 + t * 0.78})`
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
