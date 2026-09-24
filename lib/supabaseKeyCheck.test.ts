import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkSupabaseKey } from './supabaseKeyCheck';

const fakeFetch = (status: number, seen: { url?: string; headers?: Record<string, string> } = {}) =>
  (async (url: string, init: { headers: Record<string, string> }) => {
    seen.url = url;
    seen.headers = init.headers;
    return new Response('{"users":[{"email":"secret@example.com"}]}', { status });
  }) as unknown as typeof fetch;

describe('checkSupabaseKey', () => {
  it('service key: calls the admin endpoint and reports only acceptance + status', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const r = await checkSupabaseKey('https://stg.supabase.co/', 'sb_secret_abc', 'service', fakeFetch(200, seen));
    assert.deepEqual(r, { accepted: true, status: 200 });
    assert.equal(seen.url, 'https://stg.supabase.co/auth/v1/admin/users?page=1&per_page=1');
    assert.deepEqual(seen.headers, { apikey: 'sb_secret_abc' });
    assert.ok(!JSON.stringify(r).includes('secret@example.com'));
  });
  it('JWT keys also send a bearer token; anon uses public settings', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    await checkSupabaseKey('https://stg.supabase.co', 'a.b.c', 'anon', fakeFetch(200, seen));
    assert.equal(seen.url, 'https://stg.supabase.co/auth/v1/settings');
    assert.equal(seen.headers?.Authorization, 'Bearer a.b.c');
  });
  it('a key of another project is rejected (401/403)', async () => {
    assert.deepEqual(await checkSupabaseKey('https://stg.supabase.co', 'sb_secret_x', 'service', fakeFetch(401)), { accepted: false, status: 401 });
  });
  it('missing values and network failures are not accepted', async () => {
    assert.equal((await checkSupabaseKey('', 'k', 'anon')).accepted, false);
    const boom = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    assert.deepEqual(await checkSupabaseKey('https://stg.supabase.co', 'k', 'anon', boom), { accepted: false, status: null, error: 'network' });
  });
});
