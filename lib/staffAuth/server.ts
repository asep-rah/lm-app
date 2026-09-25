/**
 * Staff session cookie helpers. Import ONLY from API routes (server).
 */
import type { NextRequest, NextResponse } from 'next/server';
import {
  signStaffSession,
  STAFF_SESSION_SECRET_MIN_LENGTH,
  STAFF_SESSION_TTL_SECONDS,
  verifyStaffSession,
  type StaffSessionToken
} from '@/lib/staffAuth/core';

export const STAFF_SESSION_COOKIE = 'ldrv_staff_session';

export const staffSessionSecret = (): string => {
  const s = String(process.env.STAFF_SESSION_SECRET || '').trim();
  return s.length >= STAFF_SESSION_SECRET_MIN_LENGTH ? s : '';
};

const secureCookie = () => process.env.NODE_ENV === 'production';

export const readStaffSession = (req: NextRequest): StaffSessionToken | null => {
  const secret = staffSessionSecret();
  if (!secret) return null;
  return verifyStaffSession(req.cookies.get(STAFF_SESSION_COOKIE)?.value, secret);
};

/**
 * Why a staff API has no session — so the screen can say what to do:
 * 'not_configured' STAFF_SESSION_SECRET is missing on the server (no cookie is ever issued);
 * 'missing'        no valid cookie (never logged in through the API, or expired after 12 h).
 */
export const staffSessionProblem = (req: NextRequest): 'ok' | 'not_configured' | 'missing' => {
  if (!staffSessionSecret()) return 'not_configured';
  return readStaffSession(req) ? 'ok' : 'missing';
};

/** 401/503 answer for a staff API without a usable session (code lets the UI offer "Masuk ulang"). */
export const staffSessionError = (problem: 'not_configured' | 'missing') =>
  problem === 'not_configured'
    ? {
        status: 503,
        body: {
          error: 'Server belum siap: STAFF_SESSION_SECRET belum diisi di Vercel (Production). Hubungi pengelola aplikasi.',
          code: 'STAFF_SESSION_NOT_CONFIGURED'
        }
      }
    : {
        status: 401,
        body: { error: 'Sesi keamanan berakhir (berlaku 12 jam). Tekan "Masuk ulang".', code: 'STAFF_SESSION_REQUIRED' }
      };

/** No-op (tanpa cookie) bila STAFF_SESSION_SECRET belum dikonfigurasi. */
export const setStaffSessionCookie = (res: NextResponse, data: { sid: string; role: string }) => {
  const secret = staffSessionSecret();
  if (!secret || !data.sid) return;
  res.cookies.set(STAFF_SESSION_COOKIE, signStaffSession(data, secret), {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict',
    path: '/api',
    maxAge: STAFF_SESSION_TTL_SECONDS
  });
};

export const clearStaffSessionCookie = (res: NextResponse) => {
  res.cookies.set(STAFF_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict',
    path: '/api',
    maxAge: 0
  });
};
