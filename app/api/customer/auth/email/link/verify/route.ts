import { NextResponse, type NextRequest } from 'next/server';
import { canonicalPhone62, maskEmail } from '@/lib/customerAuth/core';
import {
  authDb,
  consumeEmailChallenge,
  customerAuthConfig,
  readNonce,
  readSession
} from '@/lib/customerAuth/server';
import { clientIp, insertAuditLog } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cfg = customerAuthConfig();
  if (!cfg.email) return NextResponse.json({ error: 'Fitur email cadangan belum diaktifkan.' }, { status: 503 });
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: 'Sesi berakhir. Masuk ulang.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = authDb();
  const result = await consumeEmailChallenge(db, {
    id: String(body?.challengeId || ''),
    channel: 'email_link',
    code: String(body?.code || '').trim(),
    nonce: readNonce(req)
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const phone = canonicalPhone62(session.phone);
  // The challenge must belong to the account that is logged in now.
  if (result.row.phone !== phone || !result.row.email) {
    return NextResponse.json({ error: 'Kode tidak cocok dengan akun ini.' }, { status: 400 });
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from('customer_auth_identities')
    .upsert([{ customer_phone: phone, email: result.row.email, email_verified_at: now, updated_at: now }], {
      onConflict: 'customer_phone'
    });
  if (error) {
    const taken = /duplicate|unique/i.test(error.message);
    return NextResponse.json(
      { error: taken ? 'Email ini sudah tertaut ke akun lain.' : 'Gagal menyimpan email. Coba lagi.' },
      { status: taken ? 409 : 500 }
    );
  }
  void insertAuditLog({
    action: 'CUSTOMER_EMAIL_LINKED',
    role: 'customer',
    entity_type: 'customer_auth_identities',
    entity_id: phone.slice(-4),
    meta: { email: maskEmail(result.row.email) },
    ip_address: clientIp(req)
  });
  return NextResponse.json({ ok: true, email: { masked: maskEmail(result.row.email), verified: true } });
}
