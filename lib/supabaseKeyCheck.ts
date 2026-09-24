/**
 * Asks the Supabase project itself whether a key belongs to it — without
 * exposing the key or any response body. New `sb_*` keys carry no project
 * ref, so this is the only reliable proof that a server key matches the URL.
 *
 * - anon/publishable: GET /auth/v1/settings (public config) → 200 only with a
 *   key of this project.
 * - service role/secret: GET /auth/v1/admin/users?per_page=1 → 200 only with
 *   a secret key of this project. The body (a user record) is discarded unread.
 */
export type KeyCheck = { accepted: boolean; status: number | null; error?: string };

const headersFor = (key: string): Record<string, string> => {
  const h: Record<string, string> = { apikey: key };
  if (key.split('.').length === 3) h.Authorization = `Bearer ${key}`;
  return h;
};

export async function checkSupabaseKey(
  url: string,
  key: string,
  kind: 'anon' | 'service',
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<KeyCheck> {
  if (!url || !key) return { accepted: false, status: null, error: 'missing' };
  const path = kind === 'anon' ? '/auth/v1/settings' : '/auth/v1/admin/users?page=1&per_page=1';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.replace(/\/+$/, '') + path, { headers: headersFor(key), signal: ctrl.signal, cache: 'no-store' });
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return { accepted: res.status === 200, status: res.status };
  } catch (e) {
    return { accepted: false, status: null, error: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
