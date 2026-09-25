import { NextResponse, type NextRequest } from 'next/server';
import { extractWaCode, parseEvolutionMessages, safeEqual } from '@/lib/customerAuth/core';
import { authDb, codeHash, customerAuthConfig, evolutionSendText } from '@/lib/customerAuth/server';
import { insertErrorLog } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

/**
 * Evolution API webhook (event MESSAGES_UPSERT) for customer WhatsApp login.
 *
 * Checks, in order: shared webhook token (query `token` or header), instance
 * name, event type, inbound 1:1 message, login code present, challenge exists
 * & pending & not expired, sender number == number entered on the web. The
 * pending→verified transition is atomic and keyed by the provider message id,
 * so webhook retries/replays are idempotent.
 *
 * Always answers 200 for well-authenticated but irrelevant events so Evolution
 * does not retry them; 401 only for a bad/missing token.
 */
export async function POST(req: NextRequest) {
  const cfg = customerAuthConfig();
  const token =
    req.nextUrl.searchParams.get('token') ||
    req.headers.get('x-webhook-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  if (!cfg.evolution.webhookToken || !safeEqual(token, cfg.evolution.webhookToken)) {
    // Diagnosis in Vercel Logs (no token/phone is logged).
    console.warn('[wa-login webhook] 401 token', token ? 'mismatch' : 'missing');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!cfg.whatsapp) return NextResponse.json({ ok: true, ignored: 'wa_login_disabled' });

  const body = await req.json().catch(() => null);
  const { event, instance, messages } = parseEvolutionMessages(body);
  if (event !== 'messages.upsert') {
    console.info('[wa-login webhook] ignored event', event || '(none)');
    return NextResponse.json({ ok: true, ignored: 'event' });
  }
  if (instance.toLowerCase() !== cfg.evolution.instance.toLowerCase()) {
    console.warn('[wa-login webhook] ignored instance', instance || '(none)', 'expected', cfg.evolution.instance);
    return NextResponse.json({ ok: true, ignored: 'instance' });
  }

  const db = authDb();
  const results: string[] = [];
  for (const msg of messages) {
    if (msg.fromMe || msg.isGroup) {
      results.push('skip');
      continue;
    }
    const code = extractWaCode(msg.text);
    if (!code) {
      results.push('no_code');
      continue;
    }
    const { data: ch } = await db
      .from('customer_login_challenges')
      .select('id, phone, status, expires_at, provider_message_id')
      .eq('code_hash', codeHash(cfg.secret, 'whatsapp', code))
      .eq('channel', 'whatsapp')
      .maybeSingle();
    if (!ch) {
      results.push('unknown_code');
      if (msg.senderPhone) {
        void evolutionSendText(msg.senderPhone, 'Kode masuk Laundrivery tidak dikenali. Buka aplikasi dan mulai ulang proses masuk.');
      }
      continue;
    }
    if (ch.provider_message_id && ch.provider_message_id === msg.messageId) {
      results.push('duplicate');
      continue;
    }
    if (ch.status !== 'pending') {
      results.push(`not_pending:${ch.status}`);
      continue;
    }
    if (new Date(ch.expires_at).getTime() <= Date.now()) {
      await db.from('customer_login_challenges').update({ status: 'expired' }).eq('id', ch.id).eq('status', 'pending');
      results.push('expired');
      if (msg.senderPhone) {
        void evolutionSendText(msg.senderPhone, 'Kode masuk Laundrivery sudah kedaluwarsa. Buka aplikasi dan minta kode baru.');
      }
      continue;
    }
    if (!msg.senderPhone) {
      await db
        .from('customer_login_challenges')
        .update({ status: 'failed', fail_reason: 'sender_unverifiable', provider_message_id: msg.messageId || null })
        .eq('id', ch.id)
        .eq('status', 'pending');
      results.push('sender_unverifiable');
      continue;
    }
    if (msg.senderPhone !== ch.phone) {
      await db
        .from('customer_login_challenges')
        .update({
          status: 'failed',
          fail_reason: 'sender_mismatch',
          sender: msg.senderPhone,
          provider_message_id: msg.messageId || null
        })
        .eq('id', ch.id)
        .eq('status', 'pending');
      results.push('sender_mismatch');
      void evolutionSendText(
        msg.senderPhone,
        'Verifikasi gagal: nomor WhatsApp ini berbeda dengan nomor yang dimasukkan di aplikasi Laundrivery.'
      );
      continue;
    }

    const { data: updated, error } = await db
      .from('customer_login_challenges')
      .update({
        status: 'verified',
        verified_at: new Date().toISOString(),
        sender: msg.senderPhone,
        provider_message_id: msg.messageId || null
      })
      .eq('id', ch.id)
      .eq('status', 'pending')
      .select('id');
    if (error) {
      await insertErrorLog({ source: 'customer_wa_login', message: error.message, context: { challenge: ch.id } });
      results.push('db_error');
      continue;
    }
    if (updated?.length) {
      results.push('verified');
      void evolutionSendText(
        msg.senderPhone,
        'Berhasil! Anda sudah masuk ke aplikasi Laundrivery. Silakan kembali ke browser/aplikasi. Jika bukan Anda yang meminta, abaikan pesan ini dan hubungi CS.'
      );
    } else {
      results.push('race_lost');
    }
  }
  // Outcome per message (verified / no_code / unknown_code / sender_mismatch / …), no phone numbers.
  if (results.some((r) => r !== 'skip' && r !== 'no_code')) console.info('[wa-login webhook]', results.join(','));
  return NextResponse.json({ ok: true, results });
}
