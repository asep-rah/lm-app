'use client';

import { formatBatchAuditLine } from '@/lib/lgThinq';

export default function WasherBatchTimeline({
  cycles,
  title = 'Audit waktu mesin (per kloter)'
}: {
  cycles?: any[] | null;
  title?: string;
}) {
  const list = [...(cycles || [])]
    .filter((c) => String(c.cycle_type || 'WASH').toUpperCase() === 'WASH' || Number(c.batch_index) > 0)
    .sort((a, b) => Number(a.batch_index || 0) - Number(b.batch_index || 0) || String(a.started_at || '').localeCompare(String(b.started_at || '')));

  if (!list.length) return null;

  return (
    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-3 space-y-1.5">
      <p className="text-[10px] font-black uppercase tracking-wider text-cyan-800">{title}</p>
      {list.map((c) => (
        <p key={c.id || `${c.batch_index}-${c.started_at}`} className="text-[11px] font-bold text-slate-800 leading-snug">
          {formatBatchAuditLine(c, list.length)}
          {c.duration_minutes ? <span className="text-slate-500 font-semibold"> · {c.duration_minutes} mnt</span> : null}
        </p>
      ))}
    </div>
  );
}
