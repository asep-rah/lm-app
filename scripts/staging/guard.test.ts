import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dbUrlMatchesRef, validateStagingEnv } from './guard';

const REF = 'mbkmhvcqklikaswlklrz';
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

describe('sessionPoolerUrl', () => {
  it('derives user postgres.<ref> and port 5432; encodes the password', async () => {
    const { sessionPoolerUrl, dbUrlMatchesRef } = await import('./guard');
    const url = sessionPoolerUrl(REF, 'aws-1-ap-southeast-1.pooler.supabase.com', 'p@ss/w:rd#1');
    const u = new URL(url);
    assert.equal(decodeURIComponent(u.username), `postgres.${REF}`);
    assert.equal(u.port, '5432');
    assert.equal(decodeURIComponent(u.password), 'p@ss/w:rd#1');
    assert.ok(dbUrlMatchesRef(url, REF));
  });
  it('refuses non-pooler hosts and empty passwords without echoing the password', async () => {
    const { sessionPoolerUrl } = await import('./guard');
    assert.throws(() => sessionPoolerUrl(REF, `db.${REF}.supabase.co`, 'x'), /Session pooler host/);
    assert.throws(() => sessionPoolerUrl(REF, 'aws-1-ap-southeast-1.pooler.supabase.com', ''), /empty/);
    try {
      sessionPoolerUrl(REF, 'evil.example.com', 'TopSecret123');
    } catch (e) {
      assert.ok(!String((e as Error).message).includes('TopSecret123'));
    }
  });
});
