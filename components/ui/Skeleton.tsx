export default function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/80 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
