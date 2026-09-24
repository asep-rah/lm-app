import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { diagnosisHintOf } from '@/lib/errorDiagnosis';
import { serverDeployEnv, serverServiceKey, serverSupabaseTarget } from '@/lib/supabaseServer';

export type GatewayName = 'mayar' | 'manual' | 'cron' | 'check-status';

const serviceClient = () => {
  const target = serverSupabaseTarget();
  if (!target.ok) throw new Error(`Akses database diblokir: ${target.reason}`);
  const key = serverServiceKey();
  if (key) {
    return createClient(target.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  if (serverDeployEnv() === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY wajib untuk operasi server ini');
  }
  // Dev lokal tanpa service role: anon key milik target yang sama (bukan produksi).
  return createClient(target.url, target.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
};

export const paymentServiceDb = (): SupabaseClient => serviceClient();

export function verifySharedSecret(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  const a = String(provided || '').trim();
  const b = String(expected || '').trim();
  if (!b) return false;
  if (!a) return false;
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return a === b;
  }
}

/** SHA512 / HMAC-SHA512 signature check (Midtrans-style or generic). */
export function verifyPaymentSignature(opts: {
  payload: string;
  signature: string | null | undefined;
  serverKey?: string | null;
}): boolean {
  const key =
    String(opts.serverKey || process.env.PAYMENT_GATEWAY_SERVER_KEY || process.env.MAYAR_WEBHOOK_SECRET || '').trim();
  const sig = String(opts.signature || '').trim();
  if (!key || !sig) return false;

  const hmacHex = createHmac('sha512', key).update(opts.payload).digest('hex');
  const shaHex = createHash('sha512').update(opts.payload + key).digest('hex');
  const candidates = [hmacHex, shaHex, hmacHex.toUpperCase(), shaHex.toUpperCase()];
  return candidates.some((c) => verifySharedSecret(sig, c)) || verifySharedSecret(sig, key);
}

export function amountsMatch(expected: number, received: number, tolerance = 1): boolean {
  const e = Math.round(Number(expected) || 0);
  const r = Math.round(Number(received) || 0);
  if (e <= 0 || r <= 0) return true;
  return Math.abs(e - r) <= tolerance;
}

export async function insertWebhookLog(row: {
  gateway: GatewayName;
  event_type?: string | null;
  external_id?: string | null;
  transaction_id?: string | null;
  http_status?: number | null;
  signature_ok?: boolean | null;
  amount_expected?: number | null;
  amount_received?: number | null;
  status?: string;
  error_message?: string | null;
  raw_payload?: unknown;
  headers?: Record<string, string | null>;
}) {
  const db = serviceClient();
  try {
    await db.from('webhook_logs').insert([
      {
        gateway: row.gateway,
        event_type: row.event_type || null,
        external_id: row.external_id || null,
        transaction_id: row.transaction_id || null,
        http_status: row.http_status ?? null,
        signature_ok: row.signature_ok ?? null,
        amount_expected: row.amount_expected ?? null,
        amount_received: row.amount_received ?? null,
        status: row.status || 'RECEIVED',
        error_message: row.error_message || null,
        raw_payload: row.raw_payload ?? null,
        headers: row.headers || null
      }
    ]);
  } catch (err) {
    console.warn('webhook_logs insert failed:', err);
  }
}

export async function insertErrorLog(row: {
  source: string;
  code?: string | null;
  message: string;
  severity?: string;
  context?: unknown;
  transaction_id?: string | null;
  hint?: string | null;
}) {
  const db = serviceClient();
  const hint = row.hint || diagnosisHintOf(row.code || row.message);
  try {
    const { error } = await db.from('error_logs').insert([
      {
        source: row.source,
        code: row.code || null,
        message: row.message,
        hint,
        severity: row.severity || 'ERROR',
        context: row.context ?? null,
        transaction_id: row.transaction_id || null
      }
    ]);
    // supabase-js returns (does not throw) insert errors; surface them in server logs.
    if (error) console.warn('error_logs insert failed:', error.code, error.message);
  } catch (err) {
    console.warn('error_logs insert failed:', err);
  }
  return hint;
}

export async function insertAuditLog(row: {
  user_id?: string | null;
  user_name?: string | null;
  role?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  amount?: number | null;
  meta?: unknown;
  ip_address?: string | null;
}) {
  const db = serviceClient();
  try {
    const { error } = await db.from('audit_logs').insert([
      {
        user_id: row.user_id || null,
        user_name: row.user_name || null,
        role: row.role || null,
        action: row.action,
        entity_type: row.entity_type || null,
        entity_id: row.entity_id || null,
        amount: row.amount ?? null,
        meta: row.meta ?? null,
        ip_address: row.ip_address || null
      }
    ]);
    if (error) console.warn('audit_logs insert failed:', error.code, error.message);
  } catch (err) {
    console.warn('audit_logs insert failed:', err);
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    ''
  );
}

export function pickWebhookHeaders(req: Request): Record<string, string | null> {
  return {
    'x-mayar-signature': req.headers.get('x-mayar-signature'),
    'x-callback-token': req.headers.get('x-callback-token'),
    'x-signature': req.headers.get('x-signature'),
    authorization: req.headers.get('authorization') ? '[redacted]' : null,
    'content-type': req.headers.get('content-type')
  };
}

/** Server-side order total — never trust client amount alone. */
export function computeServerOrderTotal(input: {
  lines?: Array<{ unitPrice?: number; qty?: number; kg?: number }>;
  deliveryFee?: number;
  discount?: number;
  clientAmount?: number;
}) {
  const lines = input.lines || [];
  let subtotal = 0;
  for (const line of lines) {
    const unit = Math.round(Number(line.unitPrice) || 0);
    const qty = Math.max(1, Number(line.qty) || 1);
    const kg = Number(line.kg);
    if (Number.isFinite(kg) && kg > 0) subtotal += Math.round(unit * kg);
    else subtotal += Math.round(unit * qty);
  }
  const delivery = Math.max(0, Math.round(Number(input.deliveryFee) || 0));
  const discount = Math.max(0, Math.round(Number(input.discount) || 0));
  const total = Math.max(0, subtotal + delivery - discount);
  const client = Math.round(Number(input.clientAmount) || 0);
  return {
    subtotal,
    delivery,
    discount,
    total,
    clientAmount: client,
    mismatch: client > 0 && Math.abs(client - total) > 1
  };
}
