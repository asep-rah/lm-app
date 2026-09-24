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
