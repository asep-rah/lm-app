/**
 * Which Supabase project this deployment may talk to — fail closed.
 *
 * Pure and isomorphic (browser, server, next.config) so the same rule is
 * enforced at build time and at runtime:
 * - Production deployment: env values, else the production project (legacy
 *   fallback kept so production never loses its database).
 * - Any other deployment (Vercel preview, local dev, tests): env URL and
 *   anon key are REQUIRED, must be valid, and must NOT belong to the
 *   production project. Otherwise the target is "blocked": clients point at
 *   an unresolvable host so every read/write fails instead of silently
 *   reaching production.
 */

export const PRODUCTION_SUPABASE_REF = 'qlgbjvzabnfqmfnjdkmo';
export const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
/** Public (publishable) production key — only ever used by production deployments. */
export const PRODUCTION_SUPABASE_ANON_KEY = 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs';
/** `.invalid` never resolves (RFC 2606): requests fail at DNS, nothing is sent anywhere. */
export const BLOCKED_SUPABASE_URL = 'https://supabase-target-blocked.invalid';
export const BLOCKED_SUPABASE_KEY = 'blocked';

export type DeployEnv = 'production' | 'preview' | 'development';

export type SupabaseTarget =
  | { ok: true; url: string; anonKey: string; projectRef: string; isProductionDb: boolean }
  | { ok: false; url: string; anonKey: string; projectRef: null; isProductionDb: false; reason: string };

const clean = (v: unknown) => String(v ?? '').trim();

export const normalizeDeployEnv = (v: unknown): DeployEnv => {
  const s = clean(v).toLowerCase();
  if (s === 'production') return 'production';
  if (s === 'preview') return 'preview';
  return 'development';
};

/**
 * Deploy environment at BUILD time (next.config). On Vercel only VERCEL_ENV
 * counts — a preview can never promote itself with LM_DEPLOY_ENV. Off Vercel,
 * LM_DEPLOY_ENV=production must be set explicitly; the default is development.
 */
export const buildDeployEnvOf = (env: Record<string, string | undefined>): DeployEnv =>
  clean(env.VERCEL) ? normalizeDeployEnv(env.VERCEL_ENV) : normalizeDeployEnv(env.LM_DEPLOY_ENV);

/** Runtime on the server: production only if BOTH the build and the runtime say so. */
export const serverDeployEnvOf = (buildValue: unknown, env: Record<string, string | undefined>): DeployEnv => {
  const built = normalizeDeployEnv(buildValue);
  if (built !== 'production') return built;
  if (clean(env.VERCEL) && normalizeDeployEnv(env.VERCEL_ENV) !== 'production') return normalizeDeployEnv(env.VERCEL_ENV);
  return 'production';
};

export const supabaseRefOfUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return host.split('.')[0] || null;
    if (host === 'localhost' || host === '127.0.0.1') return `local:${u.port || '80'}`;
    return null;
  } catch {
    return null;
  }
};

const isApiUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return u.protocol === 'http:' || u.protocol === 'https:';
    return u.protocol === 'https:' && host.endsWith('.supabase.co') && host !== 'supabase.co';
  } catch {
    return false;
  }
};

const decodeBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  if (typeof atob === 'function') return atob(b64);
  return Buffer.from(b64, 'base64').toString('utf8');
};

/** Legacy Supabase keys are JWTs carrying the project ref; new sb_* keys carry none. */
export const supabaseRefOfKey = (key: string): string | null => {
  const parts = clean(key).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return typeof payload?.ref === 'string' ? payload.ref : null;
  } catch {
    return null;
  }
};

export const isProductionKey = (key: string): boolean =>
  clean(key) === PRODUCTION_SUPABASE_ANON_KEY || supabaseRefOfKey(key) === PRODUCTION_SUPABASE_REF;

const blocked = (reason: string): SupabaseTarget => ({
  ok: false,
  url: BLOCKED_SUPABASE_URL,
  anonKey: BLOCKED_SUPABASE_KEY,
  projectRef: null,
  isProductionDb: false,
  reason
});

export const resolveSupabaseTarget = (input: { deployEnv: DeployEnv; url?: string; anonKey?: string }): SupabaseTarget => {
  const url = clean(input.url).replace(/\/+$/, '');
  const anonKey = clean(input.anonKey);

  if (input.deployEnv === 'production') {
    const finalUrl = isApiUrl(url) ? url : PRODUCTION_SUPABASE_URL;
    const ref = supabaseRefOfUrl(finalUrl);
    return {
      ok: true,
      url: finalUrl,
      anonKey: anonKey || PRODUCTION_SUPABASE_ANON_KEY,
      projectRef: ref,
      isProductionDb: ref === PRODUCTION_SUPABASE_REF
    } as SupabaseTarget;
  }

  if (!url) return blocked(`NEXT_PUBLIC_SUPABASE_URL kosong di lingkungan ${input.deployEnv}.`);
  if (!isApiUrl(url)) return blocked('NEXT_PUBLIC_SUPABASE_URL bukan URL API Supabase yang valid.');
  const ref = supabaseRefOfUrl(url);
  if (ref === PRODUCTION_SUPABASE_REF) {
    return blocked(`NEXT_PUBLIC_SUPABASE_URL menunjuk database PRODUKSI di lingkungan ${input.deployEnv}.`);
  }
  if (!anonKey) return blocked(`NEXT_PUBLIC_SUPABASE_ANON_KEY kosong di lingkungan ${input.deployEnv}.`);
  if (isProductionKey(anonKey)) return blocked('NEXT_PUBLIC_SUPABASE_ANON_KEY adalah kunci PRODUKSI.');
  const keyRef = supabaseRefOfKey(anonKey);
  if (keyRef && ref && !ref.startsWith('local:') && keyRef !== ref) {
    return blocked('NEXT_PUBLIC_SUPABASE_ANON_KEY bukan milik proyek pada NEXT_PUBLIC_SUPABASE_URL.');
  }
  return { ok: true, url, anonKey, projectRef: ref, isProductionDb: false } as SupabaseTarget;
};

/**
 * Server secret (service role) allowed for this target? Outside production a
 * key that belongs to the production project is refused.
 */
export const allowedServiceKey = (deployEnv: DeployEnv, target: SupabaseTarget, key: unknown): string => {
  const k = clean(key);
  if (!k || !target.ok) return '';
  if (deployEnv !== 'production' && supabaseRefOfKey(k) === PRODUCTION_SUPABASE_REF) return '';
  return k;
};
