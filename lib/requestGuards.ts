/**
 * Penjaga ringan untuk endpoint publik (server-side, pure — dapat diuji).
 */

const hostOf = (value: string): string => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * POST dari halaman app sendiri? Browser selalu mengirim Origin untuk fetch
 * POST; permintaan tanpa Origin atau dari origin lain ditolak.
 */
export const isSameOriginRequest = (headers: Headers): boolean => {
  const origin = headers.get('origin') || '';
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!origin || !host) return false;
  return hostOf(origin) === host;
};

/**
 * Sliding-window limiter per kunci, di memori instance. Di serverless ini
 * hanya membatasi per instance — pakai bersama batas global berbasis DB.
 */
export const createMemoryRateLimiter = (opts: { max: number; windowMs: number; maxKeys?: number }) => {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 5000;
  return (key: string, now = Date.now()): boolean => {
    const since = now - opts.windowMs;
    const list = (hits.get(key) || []).filter((t) => t > since);
    if (list.length >= opts.max) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    return true;
  };
};
