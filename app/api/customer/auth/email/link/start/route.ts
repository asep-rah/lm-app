import { NextResponse, type NextRequest } from 'next/server';
import { canonicalPhone62, generateEmailCode, isValidEmail, normalizeEmail, randomToken } from '@/lib/customerAuth/core';
import {
  authDb,
  checkChallengeRate,
  clientIpOf,
  codeHash,
  customerAuthConfig,
  EMAIL_CHALLENGE_TTL_MS,
  nonceHash,
  readNonce,
  readSession,
  sendEmailCode,
  setNonceCookie
} from '@/lib/customerAuth/server';

export const dynamic = 'force-dynamic';

/**
 * Link a backup email to the CURRENTLY verified customer session. Ownership of
 * the email is proven by a 6-digit code sent to it; nothing is linked until
 * /link/verify succeeds.
 */
export async function POST(req: NextRequest) {
  const cfg = customerAuthConfig();
  if (!cfg.email) return NextResponse.json({ error: 'Fitur email cadangan belum diaktifkan.' }, { status: 503 });
  const session = readSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Masuk dengan WhatsApp terverifikasi dulu untuk menautkan email.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(String(body?.email || ''));
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Format email tidak valid.' }, { status: 400 });

  const db = authDb();
  const phone = canonicalPhone62(session.phone);
  const { data: owner } = await db
    .from('customer_auth_identities')
    .select('customer_phone')
    .eq('email', email)
    .maybeSingle();
  if (owner && owner.customer_phone !== phone) {
    return NextResponse.json({ error: 'Email ini sudah tertaut ke akun lain.' }, { status: 409 });
  }

  const ip = clientIpOf(req);
  const rate = await checkChallengeRate(db, { channel: 'email_link', phone, ip });
  if (!rate.ok) return NextResponse.json({ error: rate.error, retryAfterSec: rate.retryAfterSec }, { status: 429 });

  const nonce = readNonce(req) || randomToken();
  const code = generateEmailCode();
  const { data: row, error } = await db
    .from('customer_login_challenges')
    .insert([
      {
        channel: 'email_link',
        phone,
        email,
        code_hash: codeHash(cfg.secret, 'email_link', `${code}:${randomToken(8)}`),
        nonce_hash: nonceHash(cfg.secret, nonce),
        ip: ip || null,
        user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) || null,
        expires_at: new Date(Date.now() + EMAIL_CHALLENGE_TTL_MS).toISOString()
      }
    ])
    .select('id')
    .single();
  if (error || !row) return NextResponse.json({ error: 'Gagal menyiapkan kode. Coba lagi.' }, { status: 500 });
  await db
    .from('customer_login_challenges')
    .update({ code_hash: codeHash(cfg.secret, 'email_link', `${row.id}:${code}`) })
    .eq('id', row.id);

  const sent = await sendEmailCode(email, code, 'link');
  if (!sent.ok) {
    await db.from('customer_login_challenges').update({ status: 'failed', fail_reason: 'send_failed' }).eq('id', row.id);
    return NextResponse.json({ error: sent.error || 'Email gagal dikirim.' }, { status: 502 });
  }
  const res = NextResponse.json({ challengeId: row.id, message: 'Kode 6 digit sudah dikirim ke email Anda.' });
  setNonceCookie(res, nonce);
  return res;
}
