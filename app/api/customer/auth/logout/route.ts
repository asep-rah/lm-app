import { NextResponse } from 'next/server';
import { clearNonceCookie, clearSessionCookie } from '@/lib/customerAuth/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  clearNonceCookie(res);
  return res;
}
