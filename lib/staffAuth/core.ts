/**
 * Signed staff session token (pure, server-side only — no I/O, unit-testable).
 *
 * Staf login lewat /api/auth/staff-login (password dicek di server). Sebelum
 * modul ini, hasil login hanya disimpan di localStorage sehingga server tidak
 * bisa memverifikasi siapa staf yang memanggil API. Token ini ditaruh di
 * cookie HttpOnly dan dipakai untuk endpoint yang butuh identitas staf yang
 * terverifikasi (saat ini: melihat foto item satuan pelanggan).
 */
import { createHmac } from 'crypto';
import { safeEqual } from '@/lib/customerAuth/core';

export type StaffSessionToken = {
  v: 1;
  /** employees.id */
  sid: string;
  role: string;
  iat: number;
  exp: number;
};

/** Satu shift + lembur; staf login ulang tiap hari kerja. */
export const STAFF_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const STAFF_SESSION_SECRET_MIN_LENGTH = 32;

const sigOf = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`staff-session\u0000${body}`).digest('base64url');

export const signStaffSession = (
  data: { sid: string; role: string },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  ttlSec = STAFF_SESSION_TTL_SECONDS
): string => {
  const payload: StaffSessionToken = {
    v: 1,
    sid: String(data.sid),
    role: String(data.role || '').toLowerCase().trim(),
    iat: nowSec,
    exp: nowSec + ttlSec
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sigOf(secret, body)}`;
};

export const verifyStaffSession = (
  token: string | null | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): StaffSessionToken | null => {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (!secret || secret.length < STAFF_SESSION_SECRET_MIN_LENGTH || dot <= 0) return null;
  const body = raw.slice(0, dot);
  if (!safeEqual(raw.slice(dot + 1), sigOf(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StaffSessionToken;
    if (p?.v !== 1 || !p.sid || !p.role || !Number.isFinite(p.exp) || p.exp <= nowSec) return null;
    return p;
  } catch {
    return null;
  }
};
