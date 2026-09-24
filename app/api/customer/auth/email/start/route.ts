import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { generateEmailCode, isValidEmail, normalizeEmail, randomToken } from '@/lib/customerAuth/core';
import {
  authDb,
  checkChallengeRate,
  clientIpOf,
  codeHash,
  customerAuthConfig,
  EMAIL_CHALLENGE_TTL_MS,
  nonceHash,
  readNonce,
  sendEmailCode,
  setNonceCookie
} from '@/lib/customerAuth/server';

export const dynamic = 'force-dynamic';

/**
 * Email-code login (backup method). Only an email that was ALREADY linked and
 * verified from a logged-in account can sign in; it always resolves to that
 * same customer (no new/duplicate account). The response is identical whether
 * or not the email is registered, to avoid account enumeration.
 */
export async function POST(req: NextRequest) {
  const cfg = customerAuthConfig();
  if (!cfg.email) return NextResponse.json({ error: 'Login email belum diaktifkan.' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(String(body?.email || ''));
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Format email tidak valid.' }, { status: 400 });

  const db = authDb();
  const ip = clientIpOf(req);
  const rate = await checkChallengeRate(db, { channel: 'email_login', email, ip });
  if (!rate.ok) return NextResponse.json({ error: rate.error, retryAfterSec: rate.retryAfterSec }, { status: 429 });

  const nonce = readNonce(req) || randomToken();
  const generic = (challengeId: string) => {
    const res = NextResponse.json({
      challengeId,
      message: 'Jika email ini sudah tertaut ke akun Laundrivery, kode 6 digit telah dikirim.'
    });
    setNonceCookie(res, nonce);
    return res;
  };

  const { data: identity } = await db
    .from('customer_auth_identities')
    .select('customer_phone, email')
    .eq('email', email)
    .not('email_verified_at', 'is', null)
    .maybeSingle();
  if (!identity) return generic(randomUUID());

  const code = generateEmailCode();
  const { data: row, error } = await db
    .from('customer_login_challenges')
    .insert([
      {
        channel: 'email_login',
        phone: identity.customer_phone,
        email,
        // Email codes are short: salt the hash with a random id so equal codes never collide.
        code_hash: codeHash(cfg.secret, 'email_login', `${code}:${randomToken(8)}`),
        nonce_hash: nonceHash(cfg.secret, nonce),
        ip: ip || null,
        user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) || null,
        expires_at: new Date(Date.now() + EMAIL_CHALLENGE_TTL_MS).toISOString()
      }
    ])
    .select('id')
    .single();
  if (error || !row) return NextResponse.json({ error: 'Gagal menyiapkan kode. Coba lagi.' }, { status: 500 });

  // Store the verifiable hash (code bound to challenge id) now that the id is known.
  await db
    .from('customer_login_challenges')
    .update({ code_hash: codeHash(cfg.secret, 'email_login', `${row.id}:${code}`) })
    .eq('id', row.id);

  const sent = await sendEmailCode(email, code, 'login');
  if (!sent.ok) {
    await db.from('customer_login_challenges').update({ status: 'failed', fail_reason: 'send_failed' }).eq('id', row.id);
    return NextResponse.json({ error: sent.error || 'Email gagal dikirim.' }, { status: 502 });
  }
  return generic(row.id);
}
