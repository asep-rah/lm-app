import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allowedServiceKey,
  BLOCKED_SUPABASE_URL,
  buildDeployEnvOf,
  PRODUCTION_SUPABASE_ANON_KEY,
  PRODUCTION_SUPABASE_URL,
  resolveSupabaseTarget,
  serverDeployEnvOf,
  supabaseRefOfKey
} from './supabaseTarget';

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const STAGING_URL = 'https://stagingref123.supabase.co';
const STAGING_KEY = 'sb_publishable_staging_key';

describe('buildDeployEnvOf / serverDeployEnvOf', () => {
  it('on Vercel only VERCEL_ENV counts; a preview cannot promote itself', () => {
    assert.equal(buildDeployEnvOf({ VERCEL: '1', VERCEL_ENV: 'production' }), 'production');
    assert.equal(buildDeployEnvOf({ VERCEL: '1', VERCEL_ENV: 'preview', LM_DEPLOY_ENV: 'production' }), 'preview');
    assert.equal(buildDeployEnvOf({ VERCEL: '1' }), 'development');
  });
  it('off Vercel defaults to development unless LM_DEPLOY_ENV=production', () => {
    assert.equal(buildDeployEnvOf({}), 'development');
    assert.equal(buildDeployEnvOf({ LM_DEPLOY_ENV: 'production' }), 'production');
  });
  it('server is production only if build AND runtime agree', () => {
    assert.equal(serverDeployEnvOf('production', {}), 'production');
    assert.equal(serverDeployEnvOf('production', { VERCEL: '1', VERCEL_ENV: 'preview' }), 'preview');
    assert.equal(serverDeployEnvOf('preview', { VERCEL: '1', VERCEL_ENV: 'production' }), 'preview');
    assert.equal(serverDeployEnvOf(undefined, {}), 'development');
  });
});

describe('resolveSupabaseTarget — preview/development fail closed', () => {
  for (const deployEnv of ['preview', 'development'] as const) {
    it(`${deployEnv}: empty env is blocked (no production fallback)`, () => {
      const t = resolveSupabaseTarget({ deployEnv });
      assert.equal(t.ok, false);
      assert.equal(t.url, BLOCKED_SUPABASE_URL);
    });
    it(`${deployEnv}: production URL is blocked even with any key`, () => {
      const t = resolveSupabaseTarget({ deployEnv, url: PRODUCTION_SUPABASE_URL + '/', anonKey: STAGING_KEY });
      assert.equal(t.ok, false);
      assert.match(t.ok ? '' : t.reason, /PRODUKSI/);
    });
    it(`${deployEnv}: production anon key (publishable or JWT) is blocked`, () => {
      assert.equal(resolveSupabaseTarget({ deployEnv, url: STAGING_URL, anonKey: PRODUCTION_SUPABASE_ANON_KEY }).ok, false);
      assert.equal(resolveSupabaseTarget({ deployEnv, url: STAGING_URL, anonKey: jwt({ ref: 'qlgbjvzabnfqmfnjdkmo', role: 'anon' }) }).ok, false);
    });
    it(`${deployEnv}: invalid URL, missing key, or key of another project is blocked`, () => {
      assert.equal(resolveSupabaseTarget({ deployEnv, url: 'https://supabase.com/dashboard/project/x', anonKey: STAGING_KEY }).ok, false);
      assert.equal(resolveSupabaseTarget({ deployEnv, url: STAGING_URL }).ok, false);
      assert.equal(resolveSupabaseTarget({ deployEnv, url: STAGING_URL, anonKey: jwt({ ref: 'otherref', role: 'anon' }) }).ok, false);
    });
    it(`${deployEnv}: staging or local project is allowed`, () => {
      const t = resolveSupabaseTarget({ deployEnv, url: STAGING_URL, anonKey: STAGING_KEY });
      assert.deepEqual(t, { ok: true, url: STAGING_URL, anonKey: STAGING_KEY, projectRef: 'stagingref123', isProductionDb: false });
      assert.equal(resolveSupabaseTarget({ deployEnv, url: 'http://127.0.0.1:54321', anonKey: 'sb_publishable_local' }).ok, true);
    });
  }
});

describe('resolveSupabaseTarget — production keeps working', () => {
  it('uses env, or the production project when env is empty', () => {
    const t = resolveSupabaseTarget({ deployEnv: 'production' });
    assert.equal(t.ok, true);
    assert.equal(t.url, PRODUCTION_SUPABASE_URL);
    assert.equal(t.isProductionDb, true);
    assert.equal(resolveSupabaseTarget({ deployEnv: 'production', url: PRODUCTION_SUPABASE_URL, anonKey: 'k' }).anonKey, 'k');
  });
});

describe('allowedServiceKey', () => {
  const staging = resolveSupabaseTarget({ deployEnv: 'preview', url: STAGING_URL, anonKey: STAGING_KEY });
  it('refuses a production service-role JWT outside production', () => {
    const prodService = jwt({ ref: 'qlgbjvzabnfqmfnjdkmo', role: 'service_role' });
    assert.equal(supabaseRefOfKey(prodService), 'qlgbjvzabnfqmfnjdkmo');
    assert.equal(allowedServiceKey('preview', staging, prodService), '');
    assert.equal(allowedServiceKey('preview', staging, 'sb_secret_staging'), 'sb_secret_staging');
  });
  it('never hands a key to a blocked target', () => {
    const blocked = resolveSupabaseTarget({ deployEnv: 'preview' });
    assert.equal(allowedServiceKey('preview', blocked, 'sb_secret_x'), '');
  });
});
