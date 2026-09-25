/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped third-party (Evolution API) webhook JSON. */
/**
 * Customer verified-login primitives (pure, server-side only).
 *
 * No I/O here so the rules can be unit-tested: phone/email normalisation,
 * one-time code generation, HMAC hashing, signed session tokens and parsing of
 * Evolution API `messages.upsert` webhook payloads.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { isValidCustomerPhone, phoneKey, storedPhone, waDigits } from '@/lib/phone';

// ---------------------------------------------------------------------------
// Phone / email identity
// ---------------------------------------------------------------------------

/**
 * Comparison key of a customer phone (lib/phone): 62… for Indonesia (as
 * before), +<cc>… for foreign numbers. Name kept for the existing callers.
 */
export const canonicalPhone62 = (raw: string): string => phoneKey(raw);

/** Stored form (lib/phone): 08… for Indonesia (customers.phone), +<cc>… for foreign numbers. */
export const localPhone08 = (raw: string): string => storedPhone(raw) || String(raw || '').replace(/\D/g, '');

/** Valid customer WhatsApp number: Indonesian mobile or any foreign number (lib/phone). */
export const isValidMobile62 = (canon: string): boolean => isValidCustomerPhone(canon);

export const normalizeEmail = (raw: string): string => String(raw || '').trim().toLowerCase();

export const isValidEmail = (email: string): boolean =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

/** a•••@domain.com — for UI display without exposing the full address. */
export const maskEmail = (email: string): string => {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '';
  return `${user.slice(0, 1)}•••${user.length > 1 ? user.slice(-1) : ''}@${domain}`;
};

// ---------------------------------------------------------------------------
// Codes, nonces, hashing
// ---------------------------------------------------------------------------

/** Unambiguous alphabet (no 0/O, 1/I/L). */
const WA_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const WA_CODE_PREFIX = 'LDRV';
const WA_CODE_RE = /\bLDRV[-\s]?([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})\b/i;

export const generateWaCode = (): string => {
  let s = '';
  for (let i = 0; i < 6; i++) s += WA_CODE_ALPHABET[randomInt(WA_CODE_ALPHABET.length)];
  return `${WA_CODE_PREFIX}-${s}`;
};

/** Finds the login code in a free-form WhatsApp message (tolerates case/space). */
export const extractWaCode = (text: string): string | null => {
  const m = String(text || '').toUpperCase().match(WA_CODE_RE);
  return m ? `${WA_CODE_PREFIX}-${m[1].toUpperCase()}` : null;
};

export const generateEmailCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Domain-separated HMAC-SHA256 so a code hash can never be reused as a nonce hash. */
export const hmacHex = (secret: string, purpose: string, value: string): string =>
  createHmac('sha256', secret).update(`${purpose}\u0000${value}`).digest('hex');

export const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (!ba.length || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
};

// ---------------------------------------------------------------------------
// Signed session token (HttpOnly cookie value)
// ---------------------------------------------------------------------------

export type CustomerSession = {
  v: 1;
  /** Local phone 08xx — the key the customer dashboard and POS already use. */
  phone: string;
  method: 'whatsapp' | 'email';
  iat: number;
  exp: number;
};

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const signSession = (
  data: { phone: string; method: CustomerSession['method'] },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  ttlSec = SESSION_TTL_SECONDS
): string => {
  const payload: CustomerSession = { v: 1, phone: data.phone, method: data.method, iat: nowSec, exp: nowSec + ttlSec };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`session\u0000${body}`).digest('base64url');
  return `${body}.${sig}`;
};

export const verifySession = (
  token: string | null | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): CustomerSession | null => {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (!secret || dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(`session\u0000${body}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomerSession;
    if (p?.v !== 1 || !p.phone || !Number.isFinite(p.exp) || p.exp <= nowSec) return null;
    if (p.method !== 'whatsapp' && p.method !== 'email') return null;
    return p;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// WhatsApp message helpers
// ---------------------------------------------------------------------------

export const buildWaPrefillMessage = (code: string): string =>
  `Kode masuk Laundrivery: ${code}\n\nKirim pesan ini tanpa diubah untuk masuk ke aplikasi. Jangan bagikan kode ini ke orang lain.`;

export const waMeLink = (systemNumber: string, text: string): string =>
  `https://wa.me/${waDigits(systemNumber)}?text=${encodeURIComponent(text)}`;

export type ParsedEvolutionMessage = {
  messageId: string;
  fromMe: boolean;
  isGroup: boolean;
  /** Canonical 62xx of the sender, '' when it cannot be proven (e.g. LID-only). */
  senderPhone: string;
  text: string;
};

const jidPhone = (jid: unknown): string => {
  const s = String(jid || '').trim();
  const m = s.match(/^(\d{8,16})(?::\d+)?@s\.whatsapp\.net$/i);
  // JIDs always carry the country code: Japan 81… must not read as Indonesian 8….
  return m ? phoneKey(m[1], { international: true }) : '';
};

const messageText = (msg: any): string =>
  String(
    msg?.conversation ||
      msg?.extendedTextMessage?.text ||
      msg?.ephemeralMessage?.message?.extendedTextMessage?.text ||
      msg?.ephemeralMessage?.message?.conversation ||
      msg?.imageMessage?.caption ||
      ''
  );

/**
 * Normalises an Evolution API (v1/v2) `messages.upsert` payload.
 * Sender phone is taken only from an explicit `@s.whatsapp.net` JID
 * (`remoteJid`, or `senderPn` / `remoteJidAlt` / `participantPn` when WhatsApp
 * uses LID addressing). A LID-only sender is left empty → login is refused.
 */
export const parseEvolutionMessages = (body: any): { event: string; instance: string; messages: ParsedEvolutionMessage[] } => {
  const event = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  const instance = String(body?.instance || body?.instanceName || '').trim();
  const rawData = body?.data;
  const list: any[] = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.messages)
    ? rawData.messages
    : rawData
    ? [rawData]
    : [];
  const messages = list.map((d) => {
    const key = d?.key || {};
    const remote = String(key.remoteJid || '');
    const isGroup = remote.endsWith('@g.us');
    const senderPhone =
      jidPhone(remote) ||
      jidPhone(key.senderPn) ||
      jidPhone(key.remoteJidAlt) ||
      jidPhone(key.participantPn) ||
      jidPhone(d?.senderPn);
    return {
      messageId: String(key.id || d?.id || ''),
      fromMe: key.fromMe === true,
      isGroup,
      senderPhone: isGroup ? '' : senderPhone,
      text: messageText(d?.message)
    };
  });
  return { event, instance, messages };
};
