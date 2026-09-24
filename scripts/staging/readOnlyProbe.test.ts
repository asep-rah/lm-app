/**
 * Integration test against a LOCAL Supabase stack with Supavisor (session mode).
 * Skipped unless LM_RO_TEST_POOLER=1 (needs 127.0.0.1:54329 and :54322).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readOnlyProbe } from './readOnlyProbe';

const enabled = process.env.LM_RO_TEST_POOLER === '1';
const env = (port: number, user: string) => ({
  ...process.env,
  PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: user, PGPASSWORD: 'postgres', PGDATABASE: 'postgres', PGSSLMODE: 'disable',
  PGOPTIONS: '-c default_transaction_read_only=on'
});

describe('readOnlyProbe through the local Session pooler', { skip: !enabled && 'set LM_RO_TEST_POOLER=1 with a local stack' }, () => {
  const pooler = env(54329, 'postgres.pooler-dev');
  it('runs probes in a read-only transaction even though the pooler drops PGOPTIONS', () => {
    assert.deepEqual(readOnlyProbe(pooler, ['select 41 + 1']), ['42']);
  });
  it('refuses writes inside the probe transaction', () => {
    assert.throws(() => readOnlyProbe(pooler, ['create table public.lm_should_not_exist(id int)']), /read-only|Command failed/);
    assert.deepEqual(readOnlyProbe(pooler, ["select (to_regclass('public.lm_should_not_exist') is null)::text"]), ['true']);
  });
});
