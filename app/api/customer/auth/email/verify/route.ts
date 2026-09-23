import { NextResponse, type NextRequest } from 'next/server';
import { localPhone08 } from '@/lib/customerAuth/core';
import {
  authDb,
  clearNonceCookie,
  consumeEmailChallenge,
  customerAuthConfig,
  customerNameOf,
  readNonce,
  setSessionCookie
} from '@/lib/customerAuth/server';
import { clientIp, insertAuditLog } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cfg = customerAuthConfig();
  if (!cfg.email) return NextResponse.json({ error: 'Login email belum diaktifkan.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const db = authDb();
  const result = await consumeEmailChallenge(db, {
    id: String(body?.challengeId || ''),
    channel: 'email_login',
    code: String(body?.code || '').trim(),
    nonce: readNonce(req)
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Re-check the link still exists and still points to the same customer.
  const { data: identity } = await db
    .from('customer_auth_identities')
    .select('customer_phone')
    .eq('email', String(result.row.email || ''))
    .not('email_verified_at', 'is', null)
    .maybeSingle();
  if (!identity || identity.customer_phone !== result.row.phone) {
    return NextResponse.json({ error: 'Email ini tidak lagi tertaut ke akun. Masuk dengan WhatsApp.' }, { status: 400 });
  }

  const phone = localPhone08(identity.customer_phone);
  const name = await customerNameOf(db, phone).catch(() => '');
  void insertAuditLog({
    action: 'CUSTOMER_LOGIN_EMAIL',
    user_name: name || null,
    role: 'customer',
    entity_type: 'customer_login_challenges',
    entity_id: result.row.id,
    meta: { phone_tail: phone.slice(-4) },
    ip_address: clientIp(req)
  });
  const res = NextResponse.json({ ok: true, phone, name });
  setSessionCookie(res, phone, 'email');
  clearNonceCookie(res);
  return res;
}
