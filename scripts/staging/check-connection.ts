/**
 * READ-ONLY connection check for staging. Writes nothing anywhere.
 *
 *   npx tsx scripts/staging/check-connection.ts --anon-only   # cloud session: STAGING_REF, STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY
 *   scripts/staging/run-staging.sh check                      # Mac: + service key + DB via Session pooler (read-only session)
 */
import { checkSupabaseKey } from '../../lib/supabaseKeyCheck';
import { log, loadStagingEnv, validateStagingApiEnv, verifyStagingKeys } from './guard';
import { readOnlyProbe } from './readOnlyProbe';

const anonOnly = process.argv.includes('--anon-only');
const env = (k: string) => String(process.env[k] || '').trim();

async function main() {
  const api = validateStagingApiEnv({ ref: env('STAGING_REF'), url: env('STAGING_SUPABASE_URL'), anonKey: env('STAGING_SUPABASE_ANON_KEY') });
  log(true, `guard: staging project ${api.ref}`);
  const anon = await checkSupabaseKey(api.url, api.anonKey, 'anon');
  log(anon.accepted, `staging accepts the anon key (status ${anon.status ?? anon.error})`);
  const rest = await fetch(`${api.url}/rest/v1/app_settings?select=id&limit=1`, {
    headers: { apikey: api.anonKey, Accept: 'application/json' }
  }).catch(() => null);
  const restNote = rest?.status === 404 ? ' (table app_settings not created yet — expected before prepare)' : '';
  log(Boolean(rest && rest.status < 500), `REST API reachable (GET app_settings → ${rest?.status ?? 'network error'})${restNote}`);
  if (anonOnly) {
    if (!anon.accepted) process.exit(1);
    return;
  }

  const s = loadStagingEnv({ needDb: true });
  await verifyStagingKeys(s);
  log(true, 'staging accepts the service key');
  const u = new URL(s.dbUrl);
  const pg: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1) || 'postgres',
    PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '15'
  };
  delete pg.PGOPTIONS;
  // Every probe runs inside BEGIN TRANSACTION READ ONLY: through the Session
  // pooler, startup options (PGOPTIONS) never reach Postgres, so none are sent.
  // Connect first, then one probe at a time so a failure names its step.
  // Failure messages come from psql stderr with the password/keys redacted.
  const where = `${u.hostname}:${u.port || '5432'} as ${decodeURIComponent(u.username)}`;
  const step = (name: string, sql: string): string => {
    try {
      return readOnlyProbe(pg, [sql])[0] ?? '';
    } catch (e) {
      log(false, `DB ${name} failed (${where}): ${(e as Error).message}`);
      process.exit(1);
    }
  };
  step('connect/login', 'select 1');
  log(true, `DB connected via ${where} — probes in a READ ONLY transaction`);
  const version = step('server_version', 'show server_version');
  const tables = step('public table count', "select count(*) from information_schema.tables where table_schema='public'");
  const markerExists = step('staging marker lookup', "select (to_regclass('lm_staging.marker') is not null)::text");
  const bucket = step('storage bucket lookup', "select coalesce((select public::text from storage.buckets where id='satuan-item-photos'), 'absent')");
  const marker = markerExists === 'true' ? step('staging marker read', 'select ref from lm_staging.marker limit 1') || 'none' : 'none';
  log(null, `server version ${version}`);
  log(null, `public tables: ${tables}`);
  log(null, `staging marker: ${marker === 'none' ? 'none (not prepared yet)' : marker}`);
  log(null, `bucket satuan-item-photos: ${bucket === 'false' ? 'private' : bucket}`);
}

main().catch((e) => {
  log(false, (e as Error).message.split('\n')[0]);
  process.exit(1);
});
