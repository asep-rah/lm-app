/**
 * READ-ONLY connection check for staging. Writes nothing anywhere.
 *
 *   npx tsx scripts/staging/check-connection.ts --anon-only   # cloud session: STAGING_REF, STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY
 *   scripts/staging/run-staging.sh check                      # Mac: + service key + DB via Session pooler (read-only session)
 */
import { execFileSync } from 'node:child_process';
import { checkSupabaseKey } from '../../lib/supabaseKeyCheck';
import { log, loadStagingEnv, validateStagingApiEnv, verifyStagingKeys } from './guard';

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
  const pg = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1) || 'postgres',
    PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000'
  };
  const q = (sql: string) => execFileSync('psql', ['-X', '-At', '-c', sql], { env: pg, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    log(q('show transaction_read_only') === 'on', `DB via ${u.hostname}:${u.port} as ${decodeURIComponent(u.username)} — session read-only`);
  } catch {
    log(false, 'DB connection failed (check Session pooler host / password / network).');
    process.exit(1);
  }
  log(null, `server version ${q('show server_version')}`);
  log(null, `public tables: ${q("select count(*) from information_schema.tables where table_schema='public'")}`);
  const marker = (() => {
    try {
      return q('select ref from lm_staging.marker limit 1');
    } catch {
      return '';
    }
  })();
  log(null, `staging marker: ${marker || 'none (not prepared yet)'}`);
  const bucket = q("select coalesce((select public::text from storage.buckets where id='satuan-item-photos'), 'absent')");
  log(null, `bucket satuan-item-photos: ${bucket === 'false' ? 'private' : bucket}`);
}

main().catch((e) => {
  log(false, (e as Error).message.split('\n')[0]);
  process.exit(1);
});
