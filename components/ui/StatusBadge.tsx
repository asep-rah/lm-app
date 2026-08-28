export default function StatusBadge({
  children,
  tone = 'slate'
}: {
  children: React.ReactNode;
  tone?: 'emerald' | 'amber' | 'sky' | 'rose' | 'slate';
}) {
  const map: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
    rose: 'bg-rose-50 text-rose-700',
    slate: 'bg-slate-100 text-slate-600'
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${map[tone]}`}>
      {children}
    </span>
  );
}
