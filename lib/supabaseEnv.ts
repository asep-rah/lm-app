/** Resolve & validate Supabase API URL for server clients. */

export const DEFAULT_SUPABASE_URL = 'https://qlgbjvzabnfqmfnjdkmo.supabase.co';

/** True if value looks like a PostgREST/API project URL (not dashboard/marketing). */
export function isSupabaseApiUrl(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    // Project API: <ref>.supabase.co — bukan supabase.com dashboard
    if (host.endsWith('.supabase.co') && host !== 'supabase.co') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * URL untuk createClient. Menolak URL dashboard (menghasilkan HTML "Supabase"),
 * fallback ke project default bila env kosong/salah.
 */
export function resolveSupabaseUrl(opts?: { allowFallback?: boolean }): string {
  const allowFallback = opts?.allowFallback !== false;
  const raw = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  if (isSupabaseApiUrl(raw)) return raw;

  if (raw) {
    console.error(
      '[supabase] NEXT_PUBLIC_SUPABASE_URL tidak valid (harus https://<ref>.supabase.co), dapat:',
      raw.slice(0, 80)
    );
  }

  if (allowFallback) return DEFAULT_SUPABASE_URL;

  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL salah. Isi https://<project-ref>.supabase.co (Settings → API), bukan URL dashboard supabase.com'
  );
}

/** Potong pesan error agar HTML/dashboard page tidak bocor ke alert UI. */
export function sanitizePublicError(err: unknown, fallback = 'Terjadi kesalahan'): string {
  const msg = String((err as any)?.message || err || '').trim();
  if (!msg) return fallback;
  if (/<!DOCTYPE html|/i.test(msg) || /<html[\s>]/i.test(msg) || /supabase-og\.png/i.test(msg)) {
    return 'Koneksi Supabase gagal: cek NEXT_PUBLIC_SUPABASE_URL di Vercel (harus https://xxx.supabase.co), lalu redeploy';
  }
  if (msg.length > 280) return msg.slice(0, 280) + '…';
  return msg;
}

export function envAuditFlags() {
  const urlRaw = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const urlOk = isSupabaseApiUrl(urlRaw) || (!urlRaw && true); // empty → fallback OK
  return {
    hasServiceRole: Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
    hasPaymentOpsSecret: Boolean(
      String(process.env.PAYMENT_OPS_SECRET || process.env.CRON_SECRET || '').trim()
    ),
    hasPublicPaymentOpsSecret: Boolean(String(process.env.NEXT_PUBLIC_PAYMENT_OPS_SECRET || '').trim()),
    hasSupabaseUrlEnv: Boolean(urlRaw),
    supabaseUrlLooksValid: urlOk && (isSupabaseApiUrl(urlRaw) || !urlRaw),
    supabaseUrlHost: (() => {
      try {
        return urlRaw ? new URL(urlRaw).hostname : '(fallback default)';
      } catch {
        return '(invalid)';
      }
    })()
  };
}
