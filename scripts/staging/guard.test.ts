import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dbUrlMatchesRef, validateStagingEnv } from './guard';

const REF = 'mbkmhvcqklikaswklrz';
const ok = {
  ref: REF,
  url: `https://${REF}.supabase.co`,
  anonKey: 'sb_publishable_staging',
  serviceKey: 'sb_secret_staging',
  dbUrl: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`
};
const jwt = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.y`;

describe('staging guard', () => {
  it('accepts the staging project (direct and pooler DB URLs)', () => {
    assert.equal(validateStagingEnv(ok, { needDb: true }).ref, REF);
    assert.ok(dbUrlMatchesRef(`postgresql://postgres.${REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`, REF));
  });
  it('refuses production anywhere', () => {
    assert.throws(() => validateStagingEnv({ ...ok, ref: 'qlgbjvzabnfqmfnjdkmo', url: 'https://qlgbjvzabnfqmfnjdkmo.supabase.co' }, { needDb: false }), /PRODUCTION/);
    assert.throws(() => validateStagingEnv({ ...ok, anonKey: 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs' }, { needDb: false }), /PRODUCTION/);
    assert.throws(() => validateStagingEnv({ ...ok, serviceKey: jwt({ ref: 'qlgbjvzabnfqmfnjdkmo', role: 'service_role' }) }, { needDb: false }), /PRODUCTION/);
    assert.throws(() => validateStagingEnv({ ...ok, dbUrl: 'postgresql://postgres:pw@db.qlgbjvzabnfqmfnjdkmo.supabase.co:5432/postgres' }, { needDb: true }), /PRODUCTION/);
  });
  it('refuses mismatched URL, DB host, key ref, or missing keys', () => {
    assert.throws(() => validateStagingEnv({ ...ok, url: 'https://otherref0000000000000.supabase.co' }, { needDb: false }), /exactly/);
    assert.throws(() => validateStagingEnv({ ...ok, dbUrl: 'postgresql://postgres:pw@localhost:5432/postgres' }, { needDb: true }), /STAGING_DB_URL/);
    assert.throws(() => validateStagingEnv({ ...ok, serviceKey: jwt({ ref: 'otherref0000000000000', role: 'service_role' }) }, { needDb: false }), /another project/);
    assert.throws(() => validateStagingEnv({ ...ok, serviceKey: '' }, { needDb: false }), /required/);
    assert.throws(() => validateStagingEnv({ ...ok, ref: 'short' }, { needDb: false }), /project ref/);
  });
  it('does not need a DB URL for API-only steps', () => {
    assert.equal(validateStagingEnv({ ...ok, dbUrl: '' }, { needDb: false }).dbUrl, '');
  });
  it('error messages never contain key values', () => {
    try {
      validateStagingEnv({ ...ok, serviceKey: 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs' }, { needDb: false });
    } catch (e) {
      assert.ok(!String((e as Error).message).includes('kDa38'));
    }
  });
});
