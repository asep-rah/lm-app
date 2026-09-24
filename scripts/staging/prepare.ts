/**
 * Prepare the STAGING database for the PR #5 tests.
 *
 *   npx tsx scripts/staging/prepare.ts --schema-dump <prod-schema.sql> [--dry-run] [--adopt-existing]
 *
 * Steps (each printed with ✓/✗, never printing keys or passwords):
 *  1. staging guard (URL / DB host / keys must be the staging project, never production)
 *  2. staging itself accepts the anon and service keys
 *  3. DB connection
 *  4. staging marker: refuses a non-empty database that was not prepared by
 *     this tool unless --adopt-existing (you confirm it is the staging DB)
 *  5. production SCHEMA-ONLY dump: validated (no data, no unreviewed outbound
 *     HTTP) and applied once, in one transaction
 *  6. PR #5 migrations, each applied once
 *  7. synthetic seed (scripts/staging/seed.sql)
 *  8. PostgREST schema reload + API verification
 *
 * --selftest-local: runs the same steps against a LOCAL Supabase stack
 * (LOCAL_SB_URL/LOCAL_SB_ANON/LOCAL_SB_SERVICE/LOCAL_DB_URL, 127.0.0.1 only)
 * to exercise this script. It is never a staging result.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { PRODUCTION_SUPABASE_REF } from '../../lib/supabaseTarget';
import { log, loadStagingEnv, verifyStagingKeys, type StagingEnv } from './guard';
import { SANITIZED_HEADER } from './sanitize-dump';
import { inspectSchemaDump, needsReview } from './schemaDump';

const ROOT = join(__dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : '';
};

/** Migrations introduced by PR #5 (git diff origin/main -- supabase/migrations). */
export const PR_MIGRATIONS = ['20260923_customer_verified_login.sql', '20260924_satuan_item_photos.sql'];

const selftest = flag('--selftest-local');
const dryRun = flag('--dry-run');

const loadEnv = (): StagingEnv => {
  if (!selftest) return loadStagingEnv({ needDb: true });
  const local = (u: string) => /^(https?|postgresql):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/.test(u);
  const e = {
    ref: 'local',
    url: String(process.env.LOCAL_SB_URL || ''),
    anonKey: String(process.env.LOCAL_SB_ANON || ''),
    serviceKey: String(process.env.LOCAL_SB_SERVICE || ''),
    dbUrl: String(process.env.LOCAL_DB_URL || '')
  };
  if (!local(e.url) || !local(e.dbUrl) || !e.anonKey || !e.serviceKey) {
    throw new Error('[selftest-local] LOCAL_* must point at 127.0.0.1/localhost.');
  }
  return e;
};

const pgEnv = (dbUrl: string): NodeJS.ProcessEnv => {
  const u = new URL(dbUrl);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: selftest ? 'disable' : 'require',
    PGCONNECT_TIMEOUT: '15'
  };
};

async function main() {
  let s: StagingEnv;
  try {
    s = loadEnv();
    log(true, `1. guard: ${selftest ? 'LOCAL SELFTEST (not staging)' : `staging project ${s.ref}`}`);
  } catch (e) {
    log(false, `1. guard: ${(e as Error).message}`);
    process.exit(2);
  }

  if (!selftest) {
    try {
      await verifyStagingKeys(s);
      log(true, '2. staging accepted the anon and service keys');
    } catch (e) {
      log(false, `2. ${(e as Error).message}`);
      process.exit(2);
    }
  } else {
    log(null, '2. key check skipped in selftest');
  }

  const env = pgEnv(s.dbUrl);
  const sql = (q: string) =>
    execFileSync('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sqlFile = (file: string, single = true) =>
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', ...(single ? ['--single-transaction'] : []), '-f', file], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

  try {
    const db = sql('select current_database()');
    log(true, `3. connected to database "${db}"`);
  } catch {
    log(false, '3. could not connect with STAGING_DB_URL (check host/password/network).');
    process.exit(2);
  }

  const markerRef = (() => {
    try {
      return sql("select ref from lm_staging.marker limit 1");
    } catch {
      return '';
    }
  })();
  const publicTables = Number(sql("select count(*) from information_schema.tables where table_schema = 'public'"));
  if (markerRef && markerRef !== s.ref) {
    log(false, `4. marker says this database belongs to "${markerRef}", not "${s.ref}". Stopping.`);
    process.exit(2);
  }
  if (!markerRef && publicTables > 0 && !flag('--adopt-existing')) {
    log(false, `4. database already has ${publicTables} public tables and no staging marker. Re-run with --adopt-existing only if you are sure this is the staging database.`);
    process.exit(2);
  }
  log(true, `4. staging marker ${markerRef ? 'present' : 'will be created'} (${publicTables} public tables now)`);

  const dumpPath = argValue('--schema-dump');
  const done = (step: string) => {
    try {
      return sql(`select 1 from lm_staging.applied where step = '${step.replace(/'/g, "''")}'`) === '1';
    } catch {
      return false;
    }
  };
  let dumpSql = '';
  if (!done('schema-dump')) {
    if (!dumpPath) {
      log(false, '5. --schema-dump <file> is required (production schema-only dump, see scripts/staging/README.md).');
      process.exit(2);
    }
    dumpSql = readFileSync(dumpPath, 'utf8');
    if (!dumpSql.startsWith(SANITIZED_HEADER + '\n')) {
      log(false, '5. not a sanitised staging copy — run: npx tsx scripts/staging/sanitize-dump.ts <prod-schema.dump.sql> <staging-schema.dump.sql>');
      process.exit(2);
    }
    const report = inspectSchemaDump(dumpSql, PRODUCTION_SUPABASE_REF);
    if (report.dataStatements.length) {
      log(false, `5. dump contains ${report.dataStatements.length} data/non-schema statement(s) — refusing. First: ${report.dataStatements[0]}`);
      process.exit(2);
    }
    if (needsReview(report)) {
      log(false, '5. sanitised copy still has outbound HTTP / production ref / secret-like findings — refusing:');
      [...report.outboundHttp, ...report.productionRefs, ...report.secretLike].slice(0, 30).forEach((l) => console.log(`     ${l}`));
      process.exit(2);
    }
    report.notes.slice(0, 20).forEach((l) => log(null, `5. note ${l}`));
    log(null, `5. ${report.functionBodyDml.length} function(s) contain DML in their bodies (definitions, not data)`);
    log(true, `5. sanitised dump validated: schema only (${dumpSql.split('\n').length} lines), no webhook/URL/secret/production ref`);
  } else {
    log(true, '5. schema dump already applied earlier');
  }

  const plan = [
    ...(done('schema-dump') ? [] : ['schema-dump']),
    ...PR_MIGRATIONS.filter((m) => !done(m)),
    'seed'
  ];
  if (dryRun) {
    log(null, `dry run — would apply: ${plan.join(', ')}`);
    return;
  }

  sql("create schema if not exists lm_staging; create table if not exists lm_staging.marker (ref text primary key, prepared_at timestamptz default now()); create table if not exists lm_staging.applied (step text primary key, applied_at timestamptz default now()); revoke all on schema lm_staging from anon, authenticated;");
  if (!markerRef) sql(`insert into lm_staging.marker (ref) values ('${s.ref}') on conflict do nothing`);

  const apply = (step: string, file: string) => {
    try {
      sqlFile(file);
      sql(`insert into lm_staging.applied (step) values ('${step}') on conflict do nothing`);
      return true;
    } catch (e) {
      const err = String((e as { stderr?: string }).stderr || (e as Error).message).split('\n').filter(Boolean).slice(0, 3).join(' | ');
      log(false, `${step}: ${err}`);
      return false;
    }
  };

  if (plan.includes('schema-dump')) {
    // Every Supabase project already has schema "public"; make the dump's
    // CREATE SCHEMA idempotent in a private temp copy (the original is untouched).
    const tmp = mkdtempSync(join(tmpdir(), 'lm-staging-'));
    const normalised = join(tmp, 'schema.sql');
    writeFileSync(normalised, dumpSql.replace(/^CREATE SCHEMA (public|"public");$/gm, 'CREATE SCHEMA IF NOT EXISTS public;'), { mode: 0o600 });
    const ok = apply('schema-dump', normalised);
    rmSync(tmp, { recursive: true, force: true });
    if (!ok) process.exit(1);
    log(true, '5. production schema applied to staging');
  }
  for (const m of PR_MIGRATIONS) {
    if (!plan.includes(m)) {
      log(true, `6. ${m} already applied`);
      continue;
    }
    if (!apply(m, join(ROOT, 'supabase/migrations', m))) process.exit(1);
    log(true, `6. ${m} applied`);
  }
  if (!apply('seed', join(ROOT, 'scripts/staging/seed.sql'))) process.exit(1);
  log(true, '7. synthetic seed applied (idempotent)');

  sql("notify pgrst, 'reload schema'");
  await new Promise((r) => setTimeout(r, 3000));
  const service = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const checks: Array<[string, () => Promise<boolean>]> = [
    ['pickup_orders readable via API', async () => !(await service.from('pickup_orders').select('id').limit(1)).error],
    ['synthetic outlets visible via API', async () => ((await service.from('outlets').select('id').like('name', '[STAGING]%')).data || []).length === 2],
    ['bucket satuan-item-photos private', async () => (await service.storage.getBucket('satuan-item-photos')).data?.public === false],
    [
      'pickup_orders.pickup_date is NOT NULL (same constraint as production)',
      async () =>
        sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='pickup_orders' and column_name='pickup_date'") === 'NO'
    ]
  ];
  let allOk = true;
  for (const [name, fn] of checks) {
    const ok = await fn().catch(() => false);
    allOk &&= ok;
    log(ok, `8. ${name}`);
  }
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  log(false, (e as Error).message.split('\n')[0]);
  process.exit(1);
});
