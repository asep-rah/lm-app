import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalPhone62,
  extractWaCode,
  generateEmailCode,
  generateWaCode,
  hmacHex,
  isValidEmail,
  isValidMobile62,
  localPhone08,
  maskEmail,
  parseEvolutionMessages,
  signSession,
  verifySession,
  waMeLink
} from './core';

const SECRET = 'test-secret-that-is-long-enough-1234567890';

describe('phone normalisation (same identity as customers/transactions)', () => {
  it('maps 08/62/+62/8 forms to one canonical and local number', () => {
    for (const raw of ['085172141494', '6285172141494', '+62 851-7214-1494', '85172141494']) {
      assert.equal(canonicalPhone62(raw), '6285172141494');
      assert.equal(localPhone08(raw), '085172141494');
    }
    assert.ok(isValidMobile62('6285172141494'));
    assert.ok(!isValidMobile62('62211234567'));
    assert.ok(!isValidMobile62('628123'));
  });
  it('foreign numbers: +<cc>… everywhere, WhatsApp JID matches what the customer typed', () => {
    assert.equal(canonicalPhone62('+65 9123 4567'), '+6591234567');
    assert.equal(localPhone08('+65 9123 4567'), '+6591234567');
    assert.ok(isValidMobile62(canonicalPhone62('+65 9123 4567')));
    assert.equal(waMeLink('+65 9123 4567', 'x'), 'https://wa.me/6591234567?text=x');
    // Japan starts with 8: the JID must not turn into an Indonesian number.
    const typed = canonicalPhone62('+81 90-1234-5678');
    const jid = parseEvolutionMessages({
      event: 'messages.upsert',
      instance: 'x',
      data: { key: { remoteJid: '819012345678@s.whatsapp.net', id: 'J1' }, message: { conversation: 'LDRV-ZZ22YY' } }
    }).messages[0].senderPhone;
    assert.equal(jid, typed);
    assert.equal(jid, '+819012345678');
    // Indonesian JID unchanged.
    assert.equal(
      parseEvolutionMessages({ event: 'messages.upsert', instance: 'x', data: { key: { remoteJid: '6285172141494@s.whatsapp.net', id: 'A' }, message: { conversation: 'x' } } })
        .messages[0].senderPhone,
      '6285172141494'
    );
  });
});

describe('one-time codes', () => {
  it('WA code format is unique-ish and extractable from a free-form message', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateWaCode();
      assert.match(c, /^LDRV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      seen.add(c);
    }
    assert.ok(seen.size > 190);
    assert.equal(extractWaCode('Kode masuk Laundrivery: LDRV-AB23CD\n\nKirim pesan ini'), 'LDRV-AB23CD');
    assert.equal(extractWaCode('ldrv ab23cd'), 'LDRV-AB23CD');
    assert.equal(extractWaCode('halo min'), null);
    // Legacy 4-digit codes (old client-side flow) are NOT accepted by the webhook.
    assert.equal(extractWaCode('Kode Akses: LDRV-1234'), null);
  });

  it('email code is 6 digits', () => {
    for (let i = 0; i < 50; i++) assert.match(generateEmailCode(), /^\d{6}$/);
  });

  it('hash is domain separated', () => {
    assert.notEqual(hmacHex(SECRET, 'code:whatsapp', 'x'), hmacHex(SECRET, 'nonce', 'x'));
  });
});

describe('session token', () => {
  it('round-trips and rejects tampering, expiry and wrong secret', () => {
    const now = 1_800_000_000;
    const tok = signSession({ phone: '085172141494', method: 'whatsapp' }, SECRET, now, 60);
    assert.equal(verifySession(tok, SECRET, now + 10)?.phone, '085172141494');
    assert.equal(verifySession(tok, SECRET, now + 61), null);
    assert.equal(verifySession(tok, 'another-secret-another-secret-12345', now), null);
    const [body, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, phone: '081111111111', method: 'whatsapp', iat: now, exp: now + 60 })).toString('base64url');
    assert.equal(verifySession(`${forged}.${sig}`, SECRET, now), null);
    assert.equal(verifySession(`${body}.x${sig}`, SECRET, now), null);
    assert.equal(verifySession('', SECRET, now), null);
  });
});

describe('email helpers', () => {
  it('validates and masks', () => {
    assert.ok(isValidEmail('asep@laundrivery.id'));
    assert.ok(!isValidEmail('asep@'));
    assert.equal(maskEmail('asep@laundrivery.id'), 'a•••p@laundrivery.id');
  });
});

describe('Evolution webhook parsing', () => {
  const base = (key: Record<string, unknown>, text = 'Kode masuk Laundrivery: LDRV-AB23CD') => ({
    event: 'messages.upsert',
    instance: 'laundrivery-login',
    data: { key: { id: 'MSG1', fromMe: false, ...key }, message: { conversation: text } }
  });

  it('reads sender from @s.whatsapp.net JID', () => {
    const p = parseEvolutionMessages(base({ remoteJid: '6285172141494@s.whatsapp.net' }));
    assert.equal(p.event, 'messages.upsert');
    assert.equal(p.messages[0].senderPhone, '6285172141494');
    assert.equal(p.messages[0].messageId, 'MSG1');
  });

  it('accepts MESSAGES_UPSERT naming and extendedTextMessage', () => {
    const p = parseEvolutionMessages({
      event: 'MESSAGES_UPSERT',
      instance: 'x',
      data: { key: { remoteJid: '6281234567890@s.whatsapp.net', id: 'A' }, message: { extendedTextMessage: { text: 'LDRV-ZZ22YY' } } }
    });
    assert.equal(p.event, 'messages.upsert');
    assert.equal(p.messages[0].text, 'LDRV-ZZ22YY');
  });

  it('uses senderPn for LID addressing, refuses LID-only senders and groups', () => {
    assert.equal(
      parseEvolutionMessages(base({ remoteJid: '123456789@lid', senderPn: '6285172141494@s.whatsapp.net' })).messages[0].senderPhone,
      '6285172141494'
    );
    assert.equal(parseEvolutionMessages(base({ remoteJid: '123456789@lid' })).messages[0].senderPhone, '');
    const g = parseEvolutionMessages(base({ remoteJid: '120363@g.us', participant: '6285172141494@s.whatsapp.net' })).messages[0];
    assert.equal(g.isGroup, true);
    assert.equal(g.senderPhone, '');
  });

  it('flags own outgoing messages', () => {
    assert.equal(parseEvolutionMessages(base({ remoteJid: '6285172141494@s.whatsapp.net', fromMe: true })).messages[0].fromMe, true);
  });

  it('builds a wa.me link to the system number with the prefilled text', () => {
    assert.equal(waMeLink('0811-2233-4455', 'a b'), 'https://wa.me/6281122334455?text=a%20b');
  });
});
