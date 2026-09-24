/**
 * Unit tests for the safe failure explanation, plus an integration test
 * against a LOCAL Supabase stack with Supavisor (session mode), skipped unless
 * LM_RO_TEST_POOLER=1 (needs 127.0.0.1:54329 and :54322).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { explainPsqlFailure, readOnlyProbe, redactPsqlText } from './readOnlyProbe';

const PW = 'S3cret-Staging-Pw!';

describe('explainPsqlFailure / redactPsqlText', () => {
  it('classifies a wrong pooler host/region (Supavisor tenant not found)', () => {
    const r = explainPsqlFailure(
      'psql: error: connection to server at "aws-0-ap-northeast-1.pooler.supabase.com" (3.1.2.3), port 5432 failed: FATAL:  Tenant or user not found\n',
      2,
      [PW]
    );
    assert.match(r.cause, /Tenant or user not found/);
    assert.match(r.hint, /Session pooler host\/region/);
  });
  it('classifies a wrong password and never echoes it', () => {
    const r = explainPsqlFailure(`psql: error: FATAL:  password authentication failed for user "postgres" (tried ${PW})\n`, 2, [PW]);
    assert.match(r.hint, /password rejected/);
    assert.ok(!r.cause.includes(PW));
  });
  it('classifies DNS, timeout and probe-level errors', () => {
    assert.match(explainPsqlFailure('psql: error: could not translate host name "x.pooler.supabase.com" to address: nodename nor servname provided', 2, []).hint, /does not resolve/);
    assert.match(explainPsqlFailure('psql: error: connection to server failed: timeout expired', 2, []).hint, /Network/);
    assert.match(explainPsqlFailure('ERROR:  permission denied for table buckets', 3, []).hint, /permission/);
    assert.match(explainPsqlFailure('', 3, []).cause, /status 3/);
  });
  it('redacts connection strings, password= and keys', () => {
    const t = redactPsqlText(
      `postgresql://postgres.ref:${PW}@h:5432/postgres password=${PW} eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.abcdEFGH sb_secret_abcDEF123`,
      [PW]
    );
    assert.ok(!t.includes(PW) && !t.includes('eyJhbGci') && !t.includes('sb_secret_abc'));
  });
});

const enabled = process.env.LM_RO_TEST_POOLER === '1';
const env = (port: number, user: string, password = 'postgres') => ({
  ...process.env,
  PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: user, PGPASSWORD: password, PGDATABASE: 'postgres', PGSSLMODE: 'disable',
  PGOPTIONS: '-c default_transaction_read_only=on'
});

describe('readOnlyProbe through the local Session pooler', { skip: !enabled && 'set LM_RO_TEST_POOLER=1 with a local stack' }, () => {
  const pooler = env(54329, 'postgres.pooler-dev');
  it('runs probes in a read-only transaction even though the pooler drops PGOPTIONS', () => {
    assert.deepEqual(readOnlyProbe(pooler, ['select 41 + 1']), ['42']);
  });
  it('refuses writes inside the probe transaction', () => {
    assert.throws(() => readOnlyProbe(pooler, ['create table public.lm_should_not_exist(id int)']), /read-only/);
    assert.deepEqual(readOnlyProbe(pooler, ["select (to_regclass('public.lm_should_not_exist') is null)::text"]), ['true']);
  });
  it('wrong tenant and wrong password give a safe, specific cause', () => {
    assert.throws(() => readOnlyProbe(env(54329, 'postgres.no-such-tenant'), ['select 1']), /Tenant or user not found|not found.*hint/i);
    assert.throws(
      () => readOnlyProbe(env(54329, 'postgres.pooler-dev', PW), ['select 1']),
      (e: Error) => !e.message.includes(PW) && /password|authentication/i.test(e.message)
    );
  });
});
