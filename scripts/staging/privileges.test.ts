/**
 * Unit tests for privilege handling, plus an integration test against a LOCAL
 * PostgreSQL that mimics Supabase roles (skipped unless LM_PG_ROLES_TEST=1;
 * see scripts/staging/README.md → "Test privileges locally").
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { describeApplyError, rehearsalScript, statementLabel, transactionControl } from './applySql';
import { defaultPrivilegesForRoles, foreignDefaultPrivileges, rolePreflight, rolesUsed } from './privileges';
import { sanitizeSchemaDump } from './sanitize-dump';
import { inspectSchemaDump, needsReview } from './schemaDump';
import { splitSqlStatements } from './sqlLexer';

const PROD = 'prodref0000000000000';
const fixture = readFileSync(join(__dirname, 'fixtures', 'pgdump16-default-privileges.sql'), 'utf8');
const stmt = (text: string) => splitSqlStatements(text)[0];

describe('ALTER DEFAULT PRIVILEGES analysis', () => {
  it('parses FOR ROLE lists and the implicit current user', () => {
    assert.deepEqual(defaultPrivilegesForRoles('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;'), ['supabase_admin']);
    assert.deepEqual(defaultPrivilegesForRoles('ALTER DEFAULT PRIVILEGES FOR USER postgres, "Ops Admin" GRANT ALL ON TABLES TO anon;'), ['postgres', 'Ops Admin']);
    assert.deepEqual(defaultPrivilegesForRoles('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;'), []);
    assert.equal(defaultPrivilegesForRoles('GRANT ALL ON TABLE public.t TO anon;'), null);
  });
  it('only FOR ROLE other than postgres is foreign', () => {
    assert.deepEqual(foreignDefaultPrivileges(stmt('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;')), []);
    assert.deepEqual(foreignDefaultPrivileges(stmt('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;')), ['supabase_admin']);
    assert.deepEqual(foreignDefaultPrivileges(stmt('COMMENT ON TABLE public.t IS $$ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin$$;')), []);
  });
  it('real pg_dump output: inspector flags the 12 supabase_admin statements, sanitizer removes exactly those', () => {
    const before = inspectSchemaDump(fixture, PROD);
    assert.equal(before.foreignDefaultPrivileges.length, 12);
    assert.ok(before.foreignDefaultPrivileges.every((l) => /FOR ROLE supabase_admin$/.test(l)));
    assert.equal(needsReview(before), true);

    const out = sanitizeSchemaDump(fixture, PROD);
    assert.deepEqual(out.removedDefaultPrivileges, { supabase_admin: 12 });
    const code = out.sql.replace(/^--.*$/gm, '');
    assert.ok(!/FOR ROLE supabase_admin/.test(code));
    assert.equal((code.match(/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres /gm) || []).length, 9, 'postgres defaults kept');
    assert.equal((code.match(/^GRANT /gm) || []).length, (fixture.match(/^GRANT /gm) || []).length, 'object GRANTs kept');
    assert.equal((code.match(/^REVOKE /gm) || []).length, (fixture.match(/^REVOKE /gm) || []).length, 'object REVOKEs kept');
    assert.match(out.sql, /^-- removed ALTER DEFAULT PRIVILEGES for roles other than postgres: supabase_admin×12$/m);
    const after = inspectSchemaDump(out.sql, PROD);
    assert.deepEqual(after.foreignDefaultPrivileges, []);
    assert.equal(needsReview(after), false);
    assert.equal(out.changes.filter((c) => /DEFAULT PRIVILEGES FOR ROLE supabase_admin/.test(c.object)).length, 12);
  });
  it('collects owners and grantees for the preflight', () => {
    const use = rolesUsed(splitSqlStatements(sanitizeSchemaDump(fixture, PROD).sql));
    assert.deepEqual([...use.owners.keys()].sort(), ['pg_database_owner', 'postgres']);
    assert.deepEqual([...use.grantees.keys()].sort(), ['anon', 'authenticated', 'postgres', 'service_role']);
    const pol = rolesUsed(splitSqlStatements('CREATE POLICY p ON public.t FOR SELECT TO authenticated, "Ops" USING (true);\nREVOKE ALL ON TABLE public.t FROM PUBLIC;'));
    assert.deepEqual([...pol.grantees.keys()], ['authenticated', 'Ops']);
  });
});

describe('applySql helpers', () => {
  it('finds top-level transaction control but not BEGIN inside DO/function bodies', () => {
    assert.deepEqual(transactionControl('do $$\nbegin\n  perform 1;\nend $$;\ncreate table t(id int);'), []);
    assert.deepEqual(transactionControl('create table t(id int);\ncommit;\n\\connect other'), ['line 2: COMMIT', 'line 3: psql meta-command \\connect']);
    assert.deepEqual(transactionControl(fixture), []);
  });
  it('names file, line and statement keywords without literals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lm-apply-'));
    const f = join(dir, 'schema.sql');
    writeFileSync(f, "SET x = 1;\n\nALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\n  GRANT ALL ON TABLES TO postgres;\n");
    const msg = describeApplyError(`psql:${f}:3: ERROR:  permission denied to change default privileges\n`, (p) => readFileSync(p, 'utf8'), () => 'staging copy');
    assert.equal(msg, 'staging copy:3: ERROR: permission denied to change default privileges — statement at line 3: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA');
    rmSync(dir, { recursive: true });
    assert.equal(statementLabel("CREATE FUNCTION f(p text DEFAULT 'secret-ish') RETURNS int AS $$ select 1 $$"), "CREATE FUNCTION f(p text DEFAULT '…') RETURNS int");
  });
  it('rehearsal script is one transaction that always ends in ROLLBACK', () => {
    const s = rehearsalScript(['/a/x.sql', "/b/it's.sql"]);
    assert.equal(s, "\\set ON_ERROR_STOP 1\nBEGIN;\n\\i '/a/x.sql'\nRESET ALL;\n\\i '/b/it''s.sql'\nRESET ALL;\nROLLBACK;\n");
  });
});

// ---- integration: local PostgreSQL with Supabase-like roles -----------------
const enabled = process.env.LM_PG_ROLES_TEST === '1';
const pgAs = (user: string, db: string): NodeJS.ProcessEnv => ({
  ...process.env,
  PGHOST: process.env.LM_PG_HOST || '/var/tmp/lmpg', PGPORT: process.env.LM_PG_PORT || '55432', PGUSER: user, PGDATABASE: db, PGSSLMODE: 'disable'
});
const psql = (env: NodeJS.ProcessEnv, args: string[]) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('apply as non-superuser postgres (local Supabase-like roles)', { skip: !enabled && 'set LM_PG_ROLES_TEST=1 with the local cluster' }, () => {
  const db = `lm_priv_${process.pid}`;
  const admin = pgAs('supabase_admin', 'postgres');
  const target = pgAs('postgres', db);
  const dir = mkdtempSync(join(tmpdir(), 'lm-priv-'));
  const file = (name: string, text: string) => {
    const f = join(dir, name);
    writeFileSync(f, text.replace(/^CREATE SCHEMA public;$/m, 'CREATE SCHEMA IF NOT EXISTS public;'));
    return f;
  };
  const count = () => psql(target, ['-c', "select count(*) from pg_class where relnamespace = 'public'::regnamespace"]).trim();

  it('setup: fresh staging-like database owned by postgres with platform defaults', () => {
    psql(admin, ['-c', `create database ${db} owner postgres`]);
    psql(pgAs('supabase_admin', db), ['-c', 'alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role']);
  });
  it('unsanitised dump fails exactly like staging and leaves nothing', () => {
    const f = file('raw.sql', fixture);
    assert.throws(
      () => psql(target, ['--single-transaction', '-f', f]),
      (e: { stderr?: string }) => {
        const msg = describeApplyError(String(e.stderr), (p) => readFileSync(p, 'utf8'));
        return /permission denied to change default privileges — statement at line \d+: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/.test(msg);
      }
    );
    assert.equal(count(), '0');
  });
  it('sanitised copy: preflight passes, rehearsal applies and rolls back, then the real apply succeeds', () => {
    const f = file('schema.sql', sanitizeSchemaDump(fixture, PROD).sql);
    assert.deepEqual(rolePreflight(target, rolesUsed(splitSqlStatements(readFileSync(f, 'utf8')))), { missing: [], notMember: [] });
    const script = join(dir, 'rehearse.sql');
    writeFileSync(script, rehearsalScript([f]));
    psql(target, ['-f', script]);
    assert.equal(count(), '0', 'rehearsal kept nothing');
    psql(target, ['--single-transaction', '-f', f]);
    assert.notEqual(count(), '0');
    assert.equal(psql(target, ['-c', "select is_nullable from information_schema.columns where table_name='pickup_orders' and column_name='pickup_date'"]).trim(), 'NO');
  });
  it('preflight reports missing roles and roles postgres cannot act as', () => {
    const use = rolesUsed(splitSqlStatements('ALTER TABLE public.t OWNER TO supabase_admin;\nGRANT ALL ON TABLE public.t TO lm_no_such_role;'));
    assert.deepEqual(rolePreflight(target, use), { missing: ['lm_no_such_role'], notMember: ['supabase_admin'] });
  });
  it('rehearsal failure keeps nothing', () => {
    const bad = file('bad.sql', 'CREATE TABLE public.lm_rehearse_tmp (id int);\nSELECT 1/0;\n');
    const script = join(dir, 'bad-rehearse.sql');
    writeFileSync(script, rehearsalScript([bad]));
    assert.throws(() => psql(target, ['-f', script]), /division by zero/);
    assert.equal(psql(target, ['-c', "select to_regclass('public.lm_rehearse_tmp') is null"]).trim(), 't');
  });
  it('teardown', () => {
    psql(admin, ['-c', `drop database ${db}`]);
    rmSync(dir, { recursive: true, force: true });
  });
});
