/**
 * Staging-only guard shared by scripts/staging/* and scripts/e2e/staging/*.
 * Every script calls loadStagingEnv() before opening any connection. It
 * refuses anything that is not the expected staging project, and never
 * prints key or password values.
 *
 * Env: STAGING_REF, STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY,
 *      STAGING_SUPABASE_SERVICE_ROLE_KEY, and for DB steps either
 *      STAGING_DB_HOST + STAGING_DB_PASSWORD (Session pooler, port 5432,
 *      user postgres.<STAGING_REF> derived here) or STAGING_DB_URL.
 */
import {
  isProductionKey,
  PRODUCTION_SUPABASE_REF,
  resolveSupabaseTarget,
  supabaseRefOfKey
} from '../../lib/supabaseTarget';
import { checkSupabaseKey } from '../../lib/supabaseKeyCheck';

export type StagingEnv = {
  ref: string;
  url: string;
  anonKey: string;
  serviceKey: string;
  dbUrl: string;
};

const env = (k: string) => String(process.env[k] || '').trim();

export class StagingGuardError extends Error {}
const refuse = (msg: string): never => {
  throw new StagingGuardError(`[staging-guard] ${msg}`);
};

/** Accepts db.<ref>.supabase.co (direct) or the pooler with user postgres.<ref>. */
export const dbUrlMatchesRef = (dbUrl: string, ref: string): boolean => {
  try {
    const u = new URL(dbUrl);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    const user = decodeURIComponent(u.username || '');
    if (host === `db.${ref}.supabase.co`) return true;
    return host.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`;
  } catch {
    return false;
  }
};

/** Session pooler connection built from parts: user and port are not user input. */
export const sessionPoolerUrl = (ref: string, host: string, password: string): string => {
  const h = String(host || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(h)) refuse('STAGING_DB_HOST must be the Session pooler host (…pooler.supabase.com).');
  if (!password) refuse('STAGING_DB_PASSWORD is empty.');
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${h}:5432/postgres`;
};

/** Ref + URL + anon key only (read-only API checks from a session without secrets). */
export const validateStagingApiEnv = (e: { ref?: string; url?: string; anonKey?: string }) => {
  const ref = String(e.ref || '');
  if (!/^[a-z0-9]{15,40}$/.test(ref)) refuse('STAGING_REF must be the staging project ref (lowercase letters/digits).');
  if (ref === PRODUCTION_SUPABASE_REF) refuse('STAGING_REF is the PRODUCTION project.');
  const url = String(e.url || '').replace(/\/+$/, '');
  if (url !== `https://${ref}.supabase.co`) refuse('STAGING_SUPABASE_URL must be exactly https://<STAGING_REF>.supabase.co.');
  const anonKey = String(e.anonKey || '');
  if (!anonKey) refuse('STAGING_SUPABASE_ANON_KEY is required.');
  if (isProductionKey(anonKey)) refuse('the anon key belongs to PRODUCTION.');
  const keyRef = supabaseRefOfKey(anonKey);
  if (keyRef && keyRef !== ref) refuse('the anon key belongs to another project.');
  return { ref, url, anonKey };
};

export const validateStagingEnv = (e: Partial<StagingEnv>, opts: { needDb: boolean }): StagingEnv => {
  const ref = String(e.ref || '');
  if (!/^[a-z0-9]{15,40}$/.test(ref)) refuse('STAGING_REF must be the staging project ref (lowercase letters/digits).');
  if (ref === PRODUCTION_SUPABASE_REF) refuse('STAGING_REF is the PRODUCTION project.');
  const url = String(e.url || '').replace(/\/+$/, '');
  if (url !== `https://${ref}.supabase.co`) refuse('STAGING_SUPABASE_URL must be exactly https://<STAGING_REF>.supabase.co.');
  const anonKey = String(e.anonKey || '');
  const serviceKey = String(e.serviceKey || '');
  if (!anonKey || !serviceKey) refuse('STAGING_SUPABASE_ANON_KEY and STAGING_SUPABASE_SERVICE_ROLE_KEY are required.');
  for (const [name, key] of [['anon', anonKey], ['service', serviceKey]] as const) {
    if (isProductionKey(key)) refuse(`the ${name} key belongs to PRODUCTION.`);
    const keyRef = supabaseRefOfKey(key);
    if (keyRef && keyRef !== ref) refuse(`the ${name} key belongs to another project.`);
  }
  if (anonKey === serviceKey) refuse('anon and service keys must differ.');
  const target = resolveSupabaseTarget({ deployEnv: 'preview', url, anonKey });
  if (!target.ok || target.projectRef !== ref) refuse(`target rejected: ${target.ok ? 'ref mismatch' : target.reason}`);
  const dbUrl = String(e.dbUrl || '');
  if (opts.needDb) {
    if (dbUrl.includes(PRODUCTION_SUPABASE_REF)) refuse('STAGING_DB_URL points at PRODUCTION.');
    if (!dbUrlMatchesRef(dbUrl, ref)) refuse('STAGING_DB_URL must be db.<STAGING_REF>.supabase.co or the pooler with user postgres.<STAGING_REF>.');
  }
  return { ref, url, anonKey, serviceKey, dbUrl };
};

export const loadStagingEnv = (opts: { needDb: boolean }): StagingEnv =>
  validateStagingEnv(
    {
      ref: env('STAGING_REF'),
      url: env('STAGING_SUPABASE_URL'),
      anonKey: env('STAGING_SUPABASE_ANON_KEY'),
      serviceKey: env('STAGING_SUPABASE_SERVICE_ROLE_KEY'),
      dbUrl:
        opts.needDb && env('STAGING_DB_HOST')
          ? sessionPoolerUrl(env('STAGING_REF'), env('STAGING_DB_HOST'), String(process.env.STAGING_DB_PASSWORD || ''))
          : env('STAGING_DB_URL')
    },
    opts
  );

/** Proof from the staging project itself that both keys belong to it. */
export async function verifyStagingKeys(s: StagingEnv): Promise<void> {
  const [anon, service] = await Promise.all([
    checkSupabaseKey(s.url, s.anonKey, 'anon'),
    checkSupabaseKey(s.url, s.serviceKey, 'service')
  ]);
  if (!anon.accepted) refuse(`staging rejected the anon key (status ${anon.status ?? anon.error}).`);
  if (!service.accepted) refuse(`staging rejected the service key (status ${service.status ?? service.error}).`);
}

export const log = (ok: boolean | null, msg: string) =>
  console.log(`${ok === null ? '•' : ok ? '✓' : '✗'} ${msg}`);
