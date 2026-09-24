/**
 * Remove rows created by the staging tests — STAGING ONLY, synthetic rows only.
 *
 *   npx tsx scripts/staging/cleanup.ts            # counts only (default)
 *   npx tsx scripts/staging/cleanup.ts --execute  # delete test orders/tasks/logs/photos
 *   npx tsx scripts/staging/cleanup.ts --execute --all   # also remove the synthetic seed
 *
 * Requires the staging guard AND the lm_staging marker written by prepare.ts.
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { log, loadStagingEnv, verifyStagingKeys } from './guard';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const all = args.includes('--all');
const selftest = args.includes('--selftest-local');

const PHONES = "('080000000001','080000000002')";
const STAFF = "('e5e50000-0000-4000-8000-0000000000e1','e5e50000-0000-4000-8000-0000000000e2','e5e50000-0000-4000-8000-0000000000e3','e5e50000-0000-4000-8000-0000000000e4')";
const ORDERS = `select id::text from pickup_orders where customer_phone in ${PHONES}`;

async function main() {
  const s = selftest
    ? { ref: 'local', url: String(process.env.LOCAL_SB_URL), serviceKey: String(process.env.LOCAL_SB_SERVICE), dbUrl: String(process.env.LOCAL_DB_URL), anonKey: '' }
    : loadStagingEnv({ needDb: true });
  if (selftest && !/127\.0\.0\.1|localhost/.test(s.url + s.dbUrl)) throw new Error('selftest must be local');
  if (!selftest) await verifyStagingKeys(s);
  const u = new URL(s.dbUrl);
  const env = {
    ...process.env,
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) || 'postgres', PGSSLMODE: selftest ? 'disable' : 'require'
  };
  const sql = (q: string) => execFileSync('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const marker = (() => { try { return sql('select ref from lm_staging.marker limit 1'); } catch { return ''; } })();
  if (marker !== s.ref) {
    log(false, `marker "${marker || 'none'}" does not match "${s.ref}" — not a database prepared by prepare.ts. Stopping.`);
    process.exit(2);
  }
  log(true, `staging ${s.ref} (marker ok)`);

  const counts = {
    system_tasks: sql(`select count(*) from system_tasks where source_id::text in (${ORDERS})`),
    pickup_orders: sql(`select count(*) from pickup_orders where customer_phone in ${PHONES}`),
    audit_logs: sql(`select count(*) from audit_logs where user_id::text in ${STAFF}`),
    error_logs: sql("select count(*) from error_logs where source = 'customer_order_form'")
  };
  const service = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const photos: string[] = [];
  const walk = async (prefix: string) => {
    const { data } = await service.storage.from('satuan-item-photos').list(prefix, { limit: 1000 });
    for (const o of data || []) {
      const p = prefix ? `${prefix}/${o.name}` : o.name;
      if (o.id) photos.push(p);
      else await walk(p);
    }
  };
  await walk('');
  log(null, `test rows: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}, photos=${photos.length}`);
  if (!execute) {
    log(null, 'dry run (use --execute to delete)');
    return;
  }
  sql(`begin;
    delete from system_tasks where source_id::text in (${ORDERS});
    delete from pickup_orders where customer_phone in ${PHONES};
    delete from audit_logs where user_id::text in ${STAFF};
    delete from error_logs where source = 'customer_order_form';
    ${all ? `delete from driver_attendance where driver_id::text in ${STAFF};
    delete from employees where id::text in ${STAFF};
    delete from customer_addresses where customer_phone in ${PHONES};
    delete from customers where phone in ${PHONES};
    delete from outlets where id in ('e5e50000-0000-4000-8000-00000000000a','e5e50000-0000-4000-8000-00000000000b');` : ''}
    commit;`);
  if (photos.length) await service.storage.from('satuan-item-photos').remove(photos);
  log(true, `deleted test rows${all ? ' and synthetic seed' : ''}; removed ${photos.length} photo(s)`);
}

main().catch((e) => {
  log(false, (e as Error).message.split('\n')[0]);
  process.exit(1);
});
