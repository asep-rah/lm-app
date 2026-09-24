import { NextResponse, type NextRequest } from 'next/server';
import {
  buildWaPrefillMessage,
  canonicalPhone62,
  generateWaCode,
  isValidMobile62,
  randomToken,
  waMeLink
} from '@/lib/customerAuth/core';
import {
  authDb,
  checkChallengeRate,
  clientIpOf,
  codeHash,
  customerAuthConfig,
  nonceHash,
  readNonce,
  setNonceCookie,
  WA_CHALLENGE_TTL_MS
} from '@/lib/customerAuth/server';

export const dynamic = 'force-dynamic';

/**
 * Step 1 of WhatsApp login: create a unique, single-use, short-lived challenge
 * bound to this browser (HttpOnly nonce cookie). The customer then sends the
 * prefilled message to the SYSTEM number; the Evolution webhook verifies it.
 */
export async function POST(req: NextRequest) {
  const cfg = customerAuthConfig();
  if (!cfg.whatsapp) {
    return NextResponse.json({ error: 'Login WhatsApp otomatis belum diaktifkan.' }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const phone = canonicalPhone62(String(body?.phone || ''));
  if (!isValidMobile62(phone)) {
    return NextResponse.json({ error: 'Nomor WhatsApp tidak valid. Contoh: 081234567890.' }, { status: 400 });
  }

  const db = authDb();
  const ip = clientIpOf(req);
  const rate = await checkChallengeRate(db, { channel: 'whatsapp', phone, ip });
  if (!rate.ok) {
    return NextResponse.json({ error: rate.error, retryAfterSec: rate.retryAfterSec }, { status: 429 });
  }

  // Reuse the browser nonce if present so older pending challenges of this
  // browser can be superseded; otherwise mint a new one.
  const nonce = readNonce(req) || randomToken();
  const nHash = nonceHash(cfg.secret, nonce);
  await db
    .from('customer_login_challenges')
    .update({ status: 'expired', fail_reason: 'superseded' })
    .eq('channel', 'whatsapp')
    .eq('nonce_hash', nHash)
    .eq('status', 'pending');

  let code = '';
  let inserted: { id: string; expires_at: string } | null = null;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    code = generateWaCode();
    const { data, error } = await db
      .from('customer_login_challenges')
      .insert([
        {
          channel: 'whatsapp',
          phone,
          code_hash: codeHash(cfg.secret, 'whatsapp', code),
          nonce_hash: nHash,
          status: 'pending',
          ip: ip || null,
          user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) || null,
          expires_at: new Date(Date.now() + WA_CHALLENGE_TTL_MS).toISOString()
        }
      ])
      .select('id, expires_at')
      .single();
    if (!error && data) inserted = data;
    else if (error && !/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'Gagal menyiapkan verifikasi. Coba lagi.' }, { status: 500 });
    }
  }
  if (!inserted) return NextResponse.json({ error: 'Gagal menyiapkan verifikasi. Coba lagi.' }, { status: 500 });

  const message = buildWaPrefillMessage(code);
  const res = NextResponse.json({
    challengeId: inserted.id,
    expiresAt: inserted.expires_at,
    code,
    waLink: waMeLink(cfg.waNumber, message),
    systemNumber: cfg.waNumber
  });
  setNonceCookie(res, nonce);
  return res;
}
