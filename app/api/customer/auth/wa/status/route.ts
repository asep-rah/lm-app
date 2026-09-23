import { NextResponse, type NextRequest } from 'next/server';
import { localPhone08, safeEqual } from '@/lib/customerAuth/core';
import {
  authDb,
  clearNonceCookie,
  customerAuthConfig,
  customerNameOf,
  nonceHash,
  readNonce,
  setSessionCookie
} from '@/lib/customerAuth/server';
import { insertAuditLog, clientIp } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

const FAIL_MESSAGES: Record<string, string> = {
  sender_mismatch: 'Pesan dikirim dari nomor WhatsApp yang berbeda dengan nomor yang Anda masukkan.',
  superseded: 'Permintaan ini sudah diganti dengan kode yang lebih baru.',
  sender_unverifiable: 'Nomor pengirim tidak dapat diverifikasi. Coba kirim ulang dari aplikasi WhatsApp utama.'
};

/**
 * Polled by the login page. Only the browser holding the HttpOnly nonce cookie
 * that started the challenge can complete it. A verified challenge is consumed
 * exactly once (atomic pending→verified→consumed) and yields the session cookie.
 */
export async function GET(req: NextRequest) {
  const cfg = customerAuthConfig();
  if (!cfg.whatsapp) return NextResponse.json({ status: 'failed', error: 'Login WhatsApp belum aktif.' }, { status: 503 });
  const id = String(req.nextUrl.searchParams.get('id') || '');
  const nonce = readNonce(req);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !nonce) {
    return NextResponse.json({ status: 'failed', error: 'Sesi verifikasi tidak ditemukan. Mulai ulang.' }, { status: 400 });
  }

  const db = authDb();
  const { data: row } = await db
    .from('customer_login_challenges')
    .select('id, channel, phone, nonce_hash, status, fail_reason, expires_at')
    .eq('id', id)
    .eq('channel', 'whatsapp')
    .maybeSingle();
  if (!row || !safeEqual(row.nonce_hash, nonceHash(cfg.secret, nonce))) {
    return NextResponse.json({ status: 'failed', error: 'Sesi verifikasi tidak ditemukan. Mulai ulang.' }, { status: 404 });
  }

  const expired = new Date(row.expires_at).getTime() <= Date.now();
  if (row.status === 'pending') {
    if (expired) {
      await db.from('customer_login_challenges').update({ status: 'expired' }).eq('id', id).eq('status', 'pending');
      return NextResponse.json({ status: 'expired' });
    }
    return NextResponse.json({ status: 'pending', expiresAt: row.expires_at });
  }
  if (row.status === 'expired') return NextResponse.json({ status: 'expired', error: FAIL_MESSAGES[row.fail_reason || ''] });
  if (row.status === 'failed') {
    return NextResponse.json({ status: 'failed', error: FAIL_MESSAGES[row.fail_reason || ''] || 'Verifikasi gagal. Mulai ulang.' });
  }
  if (row.status === 'consumed') {
    return NextResponse.json({ status: 'failed', error: 'Kode ini sudah dipakai. Mulai ulang untuk masuk lagi.' });
  }

  // status === 'verified' → consume atomically (single use).
  const { data: consumed } = await db
    .from('customer_login_challenges')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'verified')
    .select('id');
  if (!consumed?.length) {
    return NextResponse.json({ status: 'failed', error: 'Kode ini sudah dipakai. Mulai ulang untuk masuk lagi.' });
  }

  const phone = localPhone08(row.phone);
  const name = await customerNameOf(db, phone).catch(() => '');
  void insertAuditLog({
    action: 'CUSTOMER_LOGIN_WHATSAPP',
    user_name: name || null,
    role: 'customer',
    entity_type: 'customer_login_challenges',
    entity_id: id,
    meta: { phone_tail: phone.slice(-4) },
    ip_address: clientIp(req)
  });
  const res = NextResponse.json({ status: 'verified', phone, name });
  setSessionCookie(res, phone, 'whatsapp');
  clearNonceCookie(res);
  return res;
}
