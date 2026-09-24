import { createClient } from '@supabase/supabase-js';
import { normalizeDeployEnv, resolveSupabaseTarget } from '@/lib/supabaseTarget';

// NEXT_PUBLIC_* values are inlined at build time; NEXT_PUBLIC_LM_DEPLOY_ENV is
// injected by next.config from VERCEL_ENV (see lib/supabaseTarget.ts).
export const supabaseTarget = resolveSupabaseTarget({
  deployEnv: normalizeDeployEnv(process.env.NEXT_PUBLIC_LM_DEPLOY_ENV),
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
});

if (!supabaseTarget.ok) {
  console.error(`[supabase] Akses database diblokir: ${supabaseTarget.reason}`);
}

export const supabase = createClient(supabaseTarget.url, supabaseTarget.anonKey);

export default supabase;
