import { NextResponse, type NextRequest } from 'next/server';
import { maskEmail } from '@/lib/customerAuth/core';
import { authDb, customerAuthConfig, identityOfPhone, publicAuthConfig, readSession } from '@/lib/customerAuth/server';

export const dynamic = 'force-dynamic';

/**
 * Public auth config (which login methods are enabled) + the verified customer
 * session from the HttpOnly cookie, if any. Never returns secrets.
 */
export async function GET(req: NextRequest) {
  const config = publicAuthConfig();
  const session = readSession(req);
  let email: { masked: string; verified: boolean } | null = null;
  if (session && customerAuthConfig().email) {
    try {
      const identity = await identityOfPhone(authDb(), session.phone);
      if (identity?.email) email = { masked: maskEmail(identity.email), verified: Boolean(identity.email_verified_at) };
    } catch {
      email = null;
    }
  }
  return NextResponse.json(
    {
      config,
      session: session ? { phone: session.phone, method: session.method, expiresAt: session.exp * 1000, email } : null
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
