/**
 * Server-side Supabase clients (API routes, cron). Import only from server code.
 * Same fail-closed rule as the browser client: outside production, missing or
 * production-pointing env blocks every request (see lib/supabaseTarget.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  allowedServiceKey,
  resolveSupabaseTarget,
  serverDeployEnvOf,
  type DeployEnv,
  type SupabaseTarget
} from '@/lib/supabaseTarget';

export const serverDeployEnv = (): DeployEnv => serverDeployEnvOf(process.env.NEXT_PUBLIC_LM_DEPLOY_ENV, process.env);

export const serverSupabaseTarget = (): SupabaseTarget =>
  resolveSupabaseTarget({
    deployEnv: serverDeployEnv(),
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  });

/** Service-role key usable with the current target ('' when absent or refused). */
export const serverServiceKey = (): string =>
  allowedServiceKey(serverDeployEnv(), serverSupabaseTarget(), process.env.SUPABASE_SERVICE_ROLE_KEY);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/**
 * Service role when configured, else the anon key of the same target
 * (the behaviour these routes had before, minus the production fallback).
 */
export const serverSupabase = (options: { anonOnly?: boolean } = {}): SupabaseClient => {
  const target = serverSupabaseTarget();
  if (!target.ok) console.error(`[supabase] Akses database diblokir: ${target.reason}`);
  const service = options.anonOnly ? '' : serverServiceKey();
  return createClient(target.url, service || target.anonKey, opts);
};
