/**
 * Customer verified-login: server configuration, cookies, persistence and
 * provider adapters (Evolution API for WhatsApp, Resend for email).
 *
 * Import ONLY from API routes (server). Never import in client components:
 * it reads secrets and uses the service-role Supabase client.
 */
import type { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import {
  canonicalPhone62,
  hmacHex,
  localPhone08,
  safeEqual,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
  type CustomerSession
} from '@/lib/customerAuth/core';

// ---------------------------------------------------------------------------
// Configuration (all from env; nothing is hardcoded as a secret)
// ---------------------------------------------------------------------------

const env = (k: string) => String(process.env[k] || '').trim();
const flag = (k: string, dflt: boolean) => {
  const v = env(k).toLowerCase();
  if (!v) return dflt;
  return v === 'true' || v === '1' || v === 'yes';
};

/**
 * Number used by the legacy (unverified) login before this change. Kept as the
 * default so production behaviour does not change until the new flow is
 * configured and CUSTOMER_LEGACY_LOGIN_ENABLED=false is set.
 */
const LEGACY_LOGIN_WA_DEFAULT = '6285172141494';

export const customerAuthConfig = () => {
  const secret = env('CUSTOMER_AUTH_SECRET');
  const secretOk = secret.length >= 32;
  // The auth tables are service-role only (see migration), so both flows need it.
  const hasServiceRole = Boolean(env('SUPABASE_SERVICE_ROLE_KEY'));
  const waNumber = canonicalPhone62(env('CUSTOMER_WA_LOGIN_NUMBER'));
  const whatsapp =
    flag('CUSTOMER_WA_LOGIN_ENABLED', false) &&
    secretOk &&
    hasServiceRole &&
    /^62\d{8,13}$/.test(waNumber) &&
    Boolean(env('EVOLUTION_INSTANCE')) &&
    env('EVOLUTION_WEBHOOK_TOKEN').length >= 24;
  const email =
    flag('CUSTOMER_EMAIL_LOGIN_ENABLED', false) &&
    secretOk &&
    hasServiceRole &&
    Boolean(env('RESEND_API_KEY')) &&
    Boolean(env('CUSTOMER_AUTH_EMAIL_FROM'));
  const legacy = flag('CUSTOMER_LEGACY_LOGIN_ENABLED', true);
  return {
    secret,
    whatsapp,
    email,
    legacy,
    waNumber,
    legacyWaNumber: canonicalPhone62(env('CUSTOMER_LEGACY_LOGIN_WA')) || LEGACY_LOGIN_WA_DEFAULT,
    evolution: {
      apiUrl: env('EVOLUTION_API_URL').replace(/\/+$/, ''),
      apiKey: env('EVOLUTION_API_KEY'),
      instance: env('EVOLUTION_INSTANCE'),
      webhookToken: env('EVOLUTION_WEBHOOK_TOKEN'),
      replyEnabled: flag('CUSTOMER_WA_LOGIN_REPLY', true)
    },
    resend: {
      apiKey: env('RESEND_API_KEY'),
      from: env('CUSTOMER_AUTH_EMAIL_FROM'),
      // Override only for local/staging testing against a mock server.
      apiUrl: (env('RESEND_API_URL') || 'https://api.resend.com').replace(/\/+$/, '')
    }
  };
};

/**
 * Why WhatsApp login is on/off: one yes/no per requirement of
 * customerAuthConfig().whatsapp, for the owner diagnosis page. Names and
 * booleans only — never a value, length or partial secret.
 */
export const customerWaLoginChecks = () => {
  const waNumber = canonicalPhone62(env('CUSTOMER_WA_LOGIN_NUMBER'));
  const checks = [
    { key: 'CUSTOMER_WA_LOGIN_ENABLED', ok: flag('CUSTOMER_WA_LOGIN_ENABLED', false), need: 'isi true' },
    { key: 'CUSTOMER_AUTH_SECRET', ok: env('CUSTOMER_AUTH_SECRET').length >= 32, need: 'minimal 32 karakter' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', ok: Boolean(env('SUPABASE_SERVICE_ROLE_KEY')), need: 'wajib ada' },
    { key: 'CUSTOMER_WA_LOGIN_NUMBER', ok: /^62\d{8,13}$/.test(waNumber), need: 'nomor WA sistem, mis. 6285… (angka saja)' },
    { key: 'EVOLUTION_INSTANCE', ok: Boolean(env('EVOLUTION_INSTANCE')), need: 'nama instance Evolution' },
    { key: 'EVOLUTION_WEBHOOK_TOKEN', ok: env('EVOLUTION_WEBHOOK_TOKEN').length >= 24, need: 'minimal 24 karakter' }
  ];
  const c = customerAuthConfig();
  return {
    whatsapp: c.whatsapp,
    legacy: c.legacy,
    replies: Boolean(c.evolution.apiUrl && c.evolution.apiKey),
    checks
  };
};

/** Public (browser-safe) view of the configuration. Never includes secrets. */
export const publicAuthConfig = () => {
  const c = customerAuthConfig();
  return {
    whatsapp: c.whatsapp,
    email: c.email,
    legacy: c.legacy,
    // Legacy flow opens wa.me with this number (same as before this change).
    legacyWaNumber: c.legacy ? c.legacyWaNumber : null
  };
};

export const WA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const EMAIL_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 30 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_PER_IDENTITY = 5;
const RATE_MAX_PER_IP = 20;

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'ldrv_cust_session';
export const NONCE_COOKIE = 'ldrv_login_nonce';

const secureCookie = () => process.env.NODE_ENV === 'production';

export const readSession = (req: NextRequest): CustomerSession | null => {
  const c = customerAuthConfig();
  if (!c.secret) return null;
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value, c.secret);
};

export const setSessionCookie = (res: NextResponse, phone: string, method: CustomerSession['method']) => {
  const c = customerAuthConfig();
  res.cookies.set(SESSION_COOKIE, signSession({ phone: localPhone08(phone), method }, c.secret), {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  });
};

export const clearSessionCookie = (res: NextResponse) => {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: secureCookie(), sameSite: 'lax', path: '/', maxAge: 0 });
};

/** Browser-binding nonce: HttpOnly, scoped to the customer API only. */
export const setNonceCookie = (res: NextResponse, nonce: string) => {
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/api/customer',
    maxAge: 20 * 60
  });
};

export const clearNonceCookie = (res: NextResponse) => {
  res.cookies.set(NONCE_COOKIE, '', { httpOnly: true, secure: secureCookie(), sameSite: 'lax', path: '/api/customer', maxAge: 0 });
};

export const readNonce = (req: NextRequest) => String(req.cookies.get(NONCE_COOKIE)?.value || '');

export const codeHash = (secret: string, channel: string, code: string) => hmacHex(secret, `code:${channel}`, code);
export const nonceHash = (secret: string, nonce: string) => hmacHex(secret, 'nonce', nonce);

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export const authDb = (): SupabaseClient => paymentServiceDb();

export const clientIpOf = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';

export type RateResult = { ok: true } | { ok: false; error: string; retryAfterSec: number };

/**
 * DB-counted rate limit: per identity (phone/email) and per IP within 15 min,
 * plus a 30 s cooldown between challenges for the same identity.
 */
export async function checkChallengeRate(
  db: SupabaseClient,
  opts: { channel: string; phone?: string; email?: string; ip: string }
): Promise<RateResult> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  let q = db
    .from('customer_login_challenges')
    .select('created_at')
    .eq('channel', opts.channel)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(RATE_MAX_PER_IDENTITY + 1);
  q = opts.phone ? q.eq('phone', opts.phone) : q.eq('email', String(opts.email || ''));
  const { data: byId, error } = await q;
  if (error) return { ok: false, error: 'Layanan verifikasi belum siap. Coba lagi nanti.', retryAfterSec: 60 };
  const rows = byId || [];
  const last = rows[0] ? new Date(rows[0].created_at).getTime() : 0;
  if (last && Date.now() - last < RESEND_COOLDOWN_MS) {
    return { ok: false, error: 'Tunggu sebentar sebelum meminta kode baru.', retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last)) / 1000) };
  }
  if (rows.length >= RATE_MAX_PER_IDENTITY) {
    return { ok: false, error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.', retryAfterSec: 15 * 60 };
  }
  if (opts.ip) {
    const { count } = await db
      .from('customer_login_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('ip', opts.ip)
      .gte('created_at', since);
    if ((count || 0) >= RATE_MAX_PER_IP) {
      return { ok: false, error: 'Terlalu banyak percobaan dari jaringan ini. Coba lagi nanti.', retryAfterSec: 15 * 60 };
    }
  }
  return { ok: true };
}

/** Customer display name (optional) from customers table, by any phone variant. */
export async function customerNameOf(db: SupabaseClient, phone: string): Promise<string> {
  const canon = canonicalPhone62(phone);
  const variants = [...new Set([localPhone08(canon), canon, '+' + canon])];
  const { data } = await db.from('customers').select('name').in('phone', variants).limit(1);
  return String(data?.[0]?.name || '').trim();
}

export async function identityOfPhone(db: SupabaseClient, phone: string) {
  const { data } = await db
    .from('customer_auth_identities')
    .select('email, email_verified_at')
    .eq('customer_phone', canonicalPhone62(phone))
    .limit(1);
  return data?.[0] || null;
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

/** Best-effort WhatsApp reply through Evolution API v2 (`/message/sendText/{instance}`). */
export async function evolutionSendText(number: string, text: string): Promise<boolean> {
  const { evolution } = customerAuthConfig();
  if (!evolution.replyEnabled || !evolution.apiUrl || !evolution.apiKey || !evolution.instance) return false;
  try {
    const res = await fetch(`${evolution.apiUrl}/message/sendText/${encodeURIComponent(evolution.instance)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolution.apiKey },
      body: JSON.stringify({ number: canonicalPhone62(number), text }),
      signal: AbortSignal.timeout(8000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sends the one-time email code through Resend's HTTP API (no SDK dependency). */
export async function sendEmailCode(to: string, code: string, purpose: 'login' | 'link'): Promise<{ ok: boolean; error?: string }> {
  const { resend } = customerAuthConfig();
  if (!resend.apiKey || !resend.from) return { ok: false, error: 'Penyedia email belum dikonfigurasi.' };
  const subject = purpose === 'login' ? 'Kode masuk Laundrivery' : 'Verifikasi email cadangan Laundrivery';
  const intro =
    purpose === 'login'
      ? 'Gunakan kode berikut untuk masuk ke aplikasi pelanggan Laundrivery.'
      : 'Gunakan kode berikut untuk menautkan email ini sebagai cara masuk cadangan akun Laundrivery Anda.';
  const text = `${intro}\n\nKode: ${code}\n\nKode berlaku 10 menit dan hanya bisa dipakai sekali. Abaikan email ini jika Anda tidak memintanya.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#0f172a"><p>${intro}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#065fa3">${code}</p><p style="color:#475569;font-size:13px">Kode berlaku 10 menit dan hanya bisa dipakai sekali. Abaikan email ini jika Anda tidak memintanya.</p></div>`;
  try {
    const res = await fetch(`${resend.apiUrl}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resend.apiKey}` },
      body: JSON.stringify({ from: resend.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { ok: false, error: `Email gagal dikirim (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Email gagal dikirim. Coba lagi.' };
  }
}

// ---------------------------------------------------------------------------
// Email challenge verification (shared by email login and email linking)
// ---------------------------------------------------------------------------

export type EmailChallengeRow = { id: string; phone: string | null; email: string | null };

/**
 * Verifies a 6-digit email code: same browser (nonce), not expired, max
 * EMAIL_MAX_ATTEMPTS wrong tries, and consumed atomically (single use).
 * Error messages are deliberately generic.
 */
export async function consumeEmailChallenge(
  db: SupabaseClient,
  opts: { id: string; channel: 'email_login' | 'email_link'; code: string; nonce: string }
): Promise<{ ok: true; row: EmailChallengeRow } | { ok: false; error: string }> {
  const cfg = customerAuthConfig();
  const generic = { ok: false as const, error: 'Kode salah atau sudah kedaluwarsa.' };
  if (!/^[0-9a-f-]{36}$/i.test(opts.id) || !opts.nonce || !/^\d{6}$/.test(opts.code)) return generic;
  const { data: row } = await db
    .from('customer_login_challenges')
    .select('id, phone, email, code_hash, nonce_hash, status, attempts, expires_at')
    .eq('id', opts.id)
    .eq('channel', opts.channel)
    .maybeSingle();
  if (!row || row.status !== 'pending') return generic;
  if (!safeEqual(hmacHex(cfg.secret, 'nonce', opts.nonce), String(row.nonce_hash || ''))) return generic;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.from('customer_login_challenges').update({ status: 'expired' }).eq('id', row.id).eq('status', 'pending');
    return generic;
  }
  const expected = codeHash(cfg.secret, opts.channel, `${row.id}:${opts.code}`);
  if (!safeEqual(expected, String(row.code_hash || ''))) {
    const attempts = (Number(row.attempts) || 0) + 1;
    await db
      .from('customer_login_challenges')
      .update(attempts >= EMAIL_MAX_ATTEMPTS ? { attempts, status: 'failed', fail_reason: 'too_many_attempts' } : { attempts })
      .eq('id', row.id)
      .eq('status', 'pending');
    return attempts >= EMAIL_MAX_ATTEMPTS
      ? { ok: false, error: 'Terlalu banyak kode salah. Minta kode baru.' }
      : generic;
  }
  const now = new Date().toISOString();
  const { data: consumed } = await db
    .from('customer_login_challenges')
    .update({ status: 'consumed', verified_at: now, consumed_at: now })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (!consumed?.length) return generic;
  return { ok: true, row: { id: row.id, phone: row.phone, email: row.email } };
}
