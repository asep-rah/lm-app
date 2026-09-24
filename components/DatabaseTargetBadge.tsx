import { supabaseTarget } from '@/lib/supabaseClient';
import { normalizeDeployEnv } from '@/lib/supabaseTarget';

/** Non-production deployments show which database they use — or that access is blocked. */
export default function DatabaseTargetBadge() {
  if (normalizeDeployEnv(process.env.NEXT_PUBLIC_LM_DEPLOY_ENV) === 'production') return null;
  if (!supabaseTarget.ok) {
    return (
      <div role="alert" className="fixed top-0 inset-x-0 z-[100] bg-rose-700 text-white text-[11px] font-bold px-3 py-1.5 text-center">
        Database diblokir: {supabaseTarget.reason}
      </div>
    );
  }
  return (
    <div className="fixed bottom-1 left-1 z-[100] pointer-events-none rounded-md bg-amber-500/90 text-slate-950 text-[9px] font-extrabold px-1.5 py-0.5">
      NON-PRODUKSI · DB {supabaseTarget.projectRef}
    </div>
  );
}
