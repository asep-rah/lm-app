import { serverDeployEnv, serverServiceKey, serverSupabaseTarget } from '@/lib/supabaseServer';

/** Potong pesan error agar HTML/dashboard page tidak bocor ke alert UI. */
export function sanitizePublicError(err: unknown, fallback = 'Terjadi kesalahan'): string {
  const msg = String((err as any)?.message || err || '').trim();
  if (!msg) return fallback;
  const looksLikeHtml =
    /<!DOCTYPE\s*html/i.test(msg) ||
    /<html[\s>]/i.test(msg) ||
    /supabase-og\.png/i.test(msg);
  if (looksLikeHtml) {
    return 'Koneksi Supabase gagal: cek NEXT_PUBLIC_SUPABASE_URL di Vercel (harus https://xxx.supabase.co), lalu redeploy';
  }
  if (msg.length > 280) return msg.slice(0, 280) + '…';
  return msg;
}

export function envAuditFlags() {
  const target = serverSupabaseTarget();
  return {
    deployEnv: serverDeployEnv(),
    hasServiceRole: Boolean(serverServiceKey()),
    hasPaymentOpsSecret: Boolean(
      String(process.env.PAYMENT_OPS_SECRET || process.env.CRON_SECRET || '').trim()
    ),
    hasPublicPaymentOpsSecret: Boolean(String(process.env.NEXT_PUBLIC_PAYMENT_OPS_SECRET || '').trim()),
    supabaseTargetOk: target.ok,
    supabaseProjectRef: target.projectRef,
    supabaseIsProductionDb: target.isProductionDb,
    supabaseBlockedReason: target.ok ? null : target.reason
  };
}
