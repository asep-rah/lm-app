// Run after `npm run build`:  node scripts/e2e/customer-auth.e2e.mjs
// E2E: customer verified login (WhatsApp via Evolution webhook + email code)
// against `next start` with an in-memory PostgREST + mock Evolution/Resend.
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state } from './mockPostgrest.mjs';

const APP = 'http://localhost:3200';
const TOKEN = 'webhook-token-abcdefghijklmnopqrstuvwxyz';
const SYSTEM = '6281100000000';
const sent = { wa: [], email: [] };

await startMock(54321);
http
  .createServer(async (req, res) => {
    let b = '';
    for await (const c of req) b += c;
    const j = b ? JSON.parse(b) : {};
    if (req.url.startsWith('/message/sendText/')) sent.wa.push({ instance: req.url.split('/').pop(), apikey: req.headers.apikey, ...j });
    if (req.url === '/emails') sent.email.push({ auth: req.headers.authorization, ...j });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"x"}');
  })
  .listen(54322);

const env = {
  ...process.env,
  PORT: '3200',
  NODE_ENV: 'production',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  CUSTOMER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
  CUSTOMER_WA_LOGIN_ENABLED: 'true',
  CUSTOMER_WA_LOGIN_NUMBER: SYSTEM,
  EVOLUTION_INSTANCE: 'lm-login',
  EVOLUTION_WEBHOOK_TOKEN: TOKEN,
  EVOLUTION_API_URL: 'http://localhost:54322',
  EVOLUTION_API_KEY: 'evo-key',
  CUSTOMER_EMAIL_LOGIN_ENABLED: 'true',
  RESEND_API_KEY: 'resend-key',
  RESEND_API_URL: 'http://localhost:54322',
  CUSTOMER_AUTH_EMAIL_FROM: 'Laundrivery <login@example.test>',
  CUSTOMER_LEGACY_LOGIN_ENABLED: 'false'
};
const app = spawn('npx', ['next', 'start', '-p', '3200'], { cwd: new URL('../../', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', (d) => (appLog += d));
app.stderr.on('data', (d) => (appLog += d));
for (let i = 0; i < 60; i++) {
  try {
    await fetch(APP + '/api/customer/auth/session');
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

// --- tiny cookie-jar client ("browser") --------------------------------------
const browser = () => {
  const jar = new Map();
  const call = async (path, opts = {}) => {
    const res = await fetch(APP + path, {
      ...opts,
      headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      redirect: 'manual'
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      const val = v.join('=');
      if (!val || /Max-Age=0/i.test(c)) jar.delete(k);
      else jar.set(k, val);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, setCookie: res.headers.getSetCookie() };
  };
  return { call, jar };
};
const webhook = (sender, text, id, token = TOKEN, extra = {}) =>
  fetch(`${APP}/api/webhooks/evolution?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: 'lm-login',
      data: { key: { remoteJid: `${sender}@s.whatsapp.net`, fromMe: false, id, ...extra }, message: { conversation: text } }
    })
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
};

const A = browser();
let ch;
await step('config: legacy off, WA + email on', async () => {
  const r = await A.call('/api/customer/auth/session');
  assert.deepEqual(r.json.config, { whatsapp: true, email: true, legacy: false, legacyWaNumber: null });
  assert.equal(r.json.session, null);
});
await step('WA start: invalid phone rejected', async () => {
  const r = await A.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '12345' } });
  assert.equal(r.status, 400);
});
await step('WA start: challenge + HttpOnly nonce + wa.me link to SYSTEM number (not personal)', async () => {
  const r = await A.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '0812-3456-7890' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  ch = r.json;
  assert.match(ch.code, /^LDRV-[A-Z0-9]{6}$/);
  assert.ok(ch.waLink.startsWith(`https://wa.me/${SYSTEM}?text=`));
  assert.ok(decodeURIComponent(ch.waLink).includes(ch.code));
  assert.ok(r.setCookie.some((c) => c.startsWith('ldrv_login_nonce=') && /HttpOnly/i.test(c) && /Path=\/api\/customer/i.test(c)));
  const row = state.customer_login_challenges.find((x) => x.id === ch.challengeId);
  assert.equal(row.phone, '6281234567890');
  assert.ok(!JSON.stringify(row).includes(ch.code), 'plaintext code must not be stored');
  const ttl = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(ttl > 4 * 60e3 && ttl <= 5 * 60e3);
});
await step('WA start: resend cooldown → 429', async () => {
  const r = await A.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '081234567890' } });
  assert.equal(r.status, 429);
  assert.ok(r.json.retryAfterSec > 0);
});
await step('status: pending before WhatsApp message', async () => {
  const r = await A.call(`/api/customer/auth/wa/status?id=${ch.challengeId}`);
  assert.equal(r.json.status, 'pending');
});
await step('status: another browser (no nonce) cannot see/complete it', async () => {
  const B = browser();
  const r = await B.call(`/api/customer/auth/wa/status?id=${ch.challengeId}`);
  assert.ok([400, 404].includes(r.status));
});
await step('webhook: wrong token → 401, no state change', async () => {
  const r = await webhook('6281234567890', `Kode masuk Laundrivery: ${ch.code}`, 'M0', 'wrong-token');
  assert.equal(r.status, 401);
  assert.equal(state.customer_login_challenges.find((x) => x.id === ch.challengeId).status, 'pending');
});
await step('webhook: other instance ignored', async () => {
  const r = await fetch(`${APP}/api/webhooks/evolution?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'messages.upsert', instance: 'other', data: { key: { remoteJid: '6281234567890@s.whatsapp.net', id: 'M1' }, message: { conversation: ch.code } } })
  }).then((x) => x.json());
  assert.equal(r.ignored, 'instance');
});
await step('webhook: verified from the same number; confirmation reply via Evolution', async () => {
  const r = await webhook('6281234567890', `Kode masuk Laundrivery: ${ch.code}\n\nKirim pesan ini`, 'MSG-OK');
  assert.deepEqual(r.json.results, ['verified']);
  await new Promise((res) => setTimeout(res, 300));
  assert.ok(sent.wa.some((m) => m.number === '6281234567890' && m.instance === 'lm-login' && m.apikey === 'evo-key'));
});
await step('webhook: replay of the same message is idempotent', async () => {
  const r = await webhook('6281234567890', `Kode masuk Laundrivery: ${ch.code}`, 'MSG-OK');
  assert.deepEqual(r.json.results, ['duplicate']);
});
let savedNonce = '';
await step('status: verified → HttpOnly session cookie, challenge consumed', async () => {
  savedNonce = A.jar.get('ldrv_login_nonce');
  const r = await A.call(`/api/customer/auth/wa/status?id=${ch.challengeId}`);
  assert.equal(r.json.status, 'verified');
  assert.equal(r.json.phone, '081234567890');
  assert.ok(r.setCookie.some((c) => c.startsWith('ldrv_cust_session=') && /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)));
  assert.equal(state.customer_login_challenges.find((x) => x.id === ch.challengeId).status, 'consumed');
});
await step('status: single use — second completion refused', async () => {
  const r = await A.call(`/api/customer/auth/wa/status?id=${ch.challengeId}`);
  assert.equal(r.status, 400); // nonce cookie cleared after login
  // Replay with the original nonce cookie (e.g. stolen/copied) is still refused.
  const replay = browser();
  replay.jar.set('ldrv_login_nonce', savedNonce);
  const again = await replay.call(`/api/customer/auth/wa/status?id=${ch.challengeId}`);
  assert.equal(again.json.status, 'failed');
  assert.match(again.json.error, /sudah dipakai/);
  assert.ok(!again.setCookie.some((c) => c.startsWith('ldrv_cust_session=')));
});
await step('session: phone from server-signed cookie', async () => {
  const r = await A.call('/api/customer/auth/session');
  assert.equal(r.json.session.phone, '081234567890');
  assert.equal(r.json.session.method, 'whatsapp');
  assert.equal(r.json.session.email, null);
});

// --- foreign numbers (Singapore, Japan) -----------------------------------------
for (const [label, typed, jid, stored] of [
  ['Singapore', '+65 9123 4567', '6591234567', '+6591234567'],
  ['Japan (starts with 8)', '+81 90-1234-5678', '819012345678', '+819012345678']
]) {
  await step(`foreign number (${label}): WhatsApp login end-to-end, session keeps +country code`, async () => {
    const F = browser();
    const start = await F.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: typed } });
    assert.equal(start.status, 200, JSON.stringify(start.json));
    assert.equal(state.customer_login_challenges.find((x) => x.id === start.json.challengeId).phone, stored);
    const w = await webhook(jid, start.json.code, `MSG-${jid}`);
    assert.deepEqual(w.json.results, ['verified']);
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(sent.wa.some((m) => m.number === jid), 'reply goes to the digits with country code');
    const st = await F.call(`/api/customer/auth/wa/status?id=${start.json.challengeId}`);
    assert.equal(st.json.status, 'verified');
    assert.equal(st.json.phone, stored);
    assert.equal((await F.call('/api/customer/auth/session')).json.session.phone, stored);
  });
}
await step('foreign number: an Indonesian 0819… sender cannot complete a Japanese +81 login', async () => {
  const F = browser();
  const start = await F.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '+81 90-1111-2222' } });
  const w = await webhook('6281901111222', start.json.code, 'MSG-JP-ID');
  assert.deepEqual(w.json.results, ['sender_mismatch']);
});

// --- mismatch & expiry & LID ----------------------------------------------------
const C = browser();
let ch2;
await step('webhook: message from a different number → failed (sender_mismatch)', async () => {
  ch2 = (await C.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '081299990000' } })).json;
  const r = await webhook('6281200001111', ch2.code, 'MSG-MISMATCH');
  assert.deepEqual(r.json.results, ['sender_mismatch']);
  const s = await C.call(`/api/customer/auth/wa/status?id=${ch2.challengeId}`);
  assert.equal(s.json.status, 'failed');
  assert.match(s.json.error, /berbeda/);
});
await step('webhook: LID-only sender cannot be verified', async () => {
  const D = browser();
  const c3 = (await D.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '081277770000' } })).json;
  const r = await fetch(`${APP}/api/webhooks/evolution?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'messages.upsert', instance: 'lm-login', data: { key: { remoteJid: '998877@lid', id: 'MSG-LID' }, message: { conversation: c3.code } } })
  }).then((x) => x.json());
  assert.deepEqual(r.results, ['sender_unverifiable']);
});
await step('webhook: expired challenge refused', async () => {
  const E = browser();
  const c4 = (await E.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '081266660000' } })).json;
  state.customer_login_challenges.find((x) => x.id === c4.challengeId).expires_at = new Date(Date.now() - 1000).toISOString();
  const r = await webhook('6281266660000', c4.code, 'MSG-EXP');
  assert.deepEqual(r.json.results, ['expired']);
  const s = await E.call(`/api/customer/auth/wa/status?id=${c4.challengeId}`);
  assert.equal(s.json.status, 'expired');
});
await step('webhook: unknown / legacy 4-digit code ignored', async () => {
  const r = await webhook('6281234567890', 'Kode Akses: LDRV-1234', 'MSG-OLD');
  assert.deepEqual(r.json.results, ['no_code']);
});

// --- email ------------------------------------------------------------------------
let linkId;
const lastEmailCode = () => sent.email.at(-1).text.match(/Kode: (\d{6})/)[1];
await step('email link requires a verified session', async () => {
  const r = await browser().call('/api/customer/auth/email/link/start', { method: 'POST', body: { email: 'asep@example.test' } });
  assert.equal(r.status, 401);
});
await step('email link: code sent, nothing linked before verification', async () => {
  const r = await A.call('/api/customer/auth/email/link/start', { method: 'POST', body: { email: 'Asep@Example.test' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  linkId = r.json.challengeId;
  assert.equal(sent.email.at(-1).to[0], 'asep@example.test');
  assert.equal(state.customer_auth_identities.length, 0);
});
await step('email link: wrong code rejected, right code links (verified)', async () => {
  const wrong = await A.call('/api/customer/auth/email/link/verify', { method: 'POST', body: { challengeId: linkId, code: '000000' === lastEmailCode() ? '111111' : '000000' } });
  assert.equal(wrong.status, 400);
  const ok = await A.call('/api/customer/auth/email/link/verify', { method: 'POST', body: { challengeId: linkId, code: lastEmailCode() } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(state.customer_auth_identities[0].customer_phone, '6281234567890');
  assert.ok(state.customer_auth_identities[0].email_verified_at);
  const s = await A.call('/api/customer/auth/session');
  assert.deepEqual(s.json.session.email, { masked: 'a•••p@example.test', verified: true });
});
await step('email already linked to another account → 409 (no merge)', async () => {
  // Log in a second account via WA first
  const F = browser();
  const c = (await F.call('/api/customer/auth/wa/start', { method: 'POST', body: { phone: '081255550000' } })).json;
  await webhook('6281255550000', c.code, 'MSG-F');
  await F.call(`/api/customer/auth/wa/status?id=${c.challengeId}`);
  const r = await F.call('/api/customer/auth/email/link/start', { method: 'POST', body: { email: 'asep@example.test' } });
  assert.equal(r.status, 409);
});
await step('email login: linked email → session for the SAME customer', async () => {
  const G = browser();
  const before = sent.email.length;
  const st = await G.call('/api/customer/auth/email/start', { method: 'POST', body: { email: 'asep@example.test' } });
  assert.equal(st.status, 200);
  assert.equal(sent.email.length, before + 1);
  const v = await G.call('/api/customer/auth/email/verify', { method: 'POST', body: { challengeId: st.json.challengeId, code: lastEmailCode() } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.phone, '081234567890');
  const s = await G.call('/api/customer/auth/session');
  assert.equal(s.json.session.method, 'email');
  assert.equal(s.json.session.phone, '081234567890');
});
await step('email login: unknown email → same generic response, no email sent, cannot log in', async () => {
  const H = browser();
  const before = sent.email.length;
  const st = await H.call('/api/customer/auth/email/start', { method: 'POST', body: { email: 'nobody@example.test' } });
  assert.equal(st.status, 200);
  assert.match(st.json.message, /Jika email ini sudah tertaut/);
  assert.equal(sent.email.length, before);
  const v = await H.call('/api/customer/auth/email/verify', { method: 'POST', body: { challengeId: st.json.challengeId, code: '123456' } });
  assert.equal(v.status, 400);
});
await step('email login: 5 wrong codes lock the challenge', async () => {
  const I = browser();
  await new Promise((r) => setTimeout(r, 31000)); // resend cooldown per email
  const st = await I.call('/api/customer/auth/email/start', { method: 'POST', body: { email: 'asep@example.test' } });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const right = lastEmailCode();
  const wrong = right === '999999' ? '888888' : '999999';
  let last;
  for (let i = 0; i < 5; i++) last = await I.call('/api/customer/auth/email/verify', { method: 'POST', body: { challengeId: st.json.challengeId, code: wrong } });
  assert.match(last.json.error, /Terlalu banyak/);
  const late = await I.call('/api/customer/auth/email/verify', { method: 'POST', body: { challengeId: st.json.challengeId, code: right } });
  assert.equal(late.status, 400);
});
await step('logout clears session', async () => {
  await A.call('/api/customer/auth/logout', { method: 'POST' });
  const s = await A.call('/api/customer/auth/session');
  assert.equal(s.json.session, null);
});
await step('secrets never exposed by public config', async () => {
  const r = await fetch(APP + '/api/customer/auth/session').then((x) => x.text());
  for (const secret of [TOKEN, 'evo-key', 'resend-key', env.CUSTOMER_AUTH_SECRET, 'test-service-role']) assert.ok(!r.includes(secret));
});

app.kill();
for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) console.log(appLog.slice(-3000));
process.exit(failed ? 1 : 0);
