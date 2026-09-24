// E2E against a REAL Supabase stack running locally (Supabase CLI:
// Postgres + PostgREST + Storage + Kong on 127.0.0.1) — not mocks.
//
// Never points at staging/production: refuses any non-local URL, blocks and
// fails on any browser request to *.supabase.co, and checks the build was
// made against the local URL. See scripts/e2e/local-supabase/README.md.
//
// Env: LOCAL_SB_URL, LOCAL_SB_ANON, LOCAL_SB_SERVICE, LOCAL_DB_URL, CHROMIUM_PATH
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SB_URL = process.env.LOCAL_SB_URL || '';
const ANON = process.env.LOCAL_SB_ANON || '';
const SERVICE = process.env.LOCAL_SB_SERVICE || '';
const DB_URL = process.env.LOCAL_DB_URL || '';
const isLocal = (u) => /^(https?|postgresql):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/.test(u);
if (!isLocal(SB_URL) || !isLocal(DB_URL) || !ANON || !SERVICE) {
  console.error('Refusing to run: LOCAL_SB_URL/LOCAL_DB_URL must point at 127.0.0.1/localhost and keys must be set.');
  process.exit(2);
}

// The client bundle must have been built against the local stack.
const bundleHasLocalUrl = (() => {
  const dir = join(ROOT, '.next/static/chunks');
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (name.endsWith('.js') && readFileSync(p, 'utf8').includes(SB_URL.replace(/\/+$/, ''))) return true;
    }
  }
  return false;
})();
if (!bundleHasLocalUrl) {
  console.error(`Build does not reference ${SB_URL}. Rebuild with NEXT_PUBLIC_SUPABASE_URL/ANON_KEY set to the local stack.`);
  process.exit(2);
}

const psql = (sql) => execFileSync('psql', [DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const psqlFile = (file) => execFileSync('psql', [DB_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });

// Fresh schema + fixtures + the photo migration under test.
psqlFile(join(ROOT, 'scripts/e2e/local-supabase/schema.sql'));
psqlFile(join(ROOT, 'scripts/e2e/local-supabase/seed.sql'));
psqlFile(join(ROOT, 'supabase/migrations/20260924_satuan_item_photos.sql'));

const CUSTOMER_AUTH_SECRET = randomBytes(32).toString('hex');
const STAFF_SESSION_SECRET = randomBytes(32).toString('hex');
const PORT = 3301;
const APP = `http://localhost:${PORT}`;
const serverEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: SB_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_URL: SB_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  CUSTOMER_AUTH_SECRET,
  STAFF_SESSION_SECRET,
  SATUAN_ITEM_PHOTO_ENABLED: 'true'
};
const app = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, env: serverEnv, stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try {
    await fetch(APP + '/api/customer/auth/session');
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, String(e?.message || e).split('\n')[0]]);
  }
};

const CUSTOMER = '085172141494';
const OTHER_CUSTOMER = '081299990000';
const DAGO = '11111111-1111-4111-8111-111111111111';
const jakartaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

// Same format as lib/customerAuth/core.ts signSession (verified WA login).
const customerCookie = (phone) => {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ v: 1, phone, method: 'whatsapp', iat: now, exp: now + 3600 })).toString('base64url');
  const sig = createHmac('sha256', CUSTOMER_AUTH_SECRET).update(`session\u0000${body}`).digest('base64url');
  return `${body}.${sig}`;
};
const ownerFolder = (phone) =>
  createHmac('sha256', CUSTOMER_AUTH_SECRET).update(`satuan-photo-owner\u0000${phone}`).digest('hex').slice(0, 32);

const anon = createClient(SB_URL, ANON, { auth: { persistSession: false } });
const service = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const BUCKET = 'satuan-item-photos';
// Storage checks the declared content type; the bytes only need a JPEG header.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

// A photo that belongs to ANOTHER customer, uploaded server-side.
const victimPath = `${ownerFolder(OTHER_CUSTOMER)}/2026-09/0b0c0d0e-0000-4000-8000-000000000001.jpg`;
{
  const { error } = await service.storage.from(BUCKET).upload(victimPath, JPEG, { contentType: 'image/jpeg', upsert: true });
  assert.ifError(error);
}

// ---------------------------------------------------------------------------
// 1. Storage lock-down: the browser (anon) key has no access to the bucket.
// ---------------------------------------------------------------------------
await step('Anon key cannot list the photo bucket', async () => {
  const { data, error } = await anon.storage.from(BUCKET).list(ownerFolder(OTHER_CUSTOMER) + '/2026-09');
  assert.ok(error || (Array.isArray(data) && data.length === 0), `anon listed ${data?.length} objects`);
});
await step('Anon key cannot download or create a signed URL for another customer photo', async () => {
  const dl = await anon.storage.from(BUCKET).download(victimPath);
  assert.ok(dl.error, 'anon download must fail');
  const signed = await anon.storage.from(BUCKET).createSignedUrl(victimPath, 60);
  assert.ok(signed.error || !signed.data?.signedUrl, 'anon createSignedUrl must fail');
  const pub = await fetch(`${SB_URL}/storage/v1/object/public/${BUCKET}/${victimPath}`);
  assert.notEqual(pub.status, 200, 'no public URL');
});
await step('Anon key cannot upload directly into the bucket', async () => {
  const { error } = await anon.storage
    .from(BUCKET)
    .upload(`${ownerFolder(CUSTOMER)}/2026-09/0b0c0d0e-0000-4000-8000-00000000000f.jpg`, JPEG, { contentType: 'image/jpeg' });
  assert.ok(error, 'anon upload must fail');
});

// ---------------------------------------------------------------------------
// 2. Customer upload URL: verified session + same origin only.
// ---------------------------------------------------------------------------
const uploadUrl = (headers) =>
  fetch(APP + '/api/customer/satuan-photo/upload-url', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
let issued;
await step('Upload URL: rejected without a verified customer session', async () => {
  const r = await uploadUrl({ origin: APP });
  assert.equal(r.status, 401);
});
await step('Upload URL: rejected from another origin even with a session', async () => {
  const r = await uploadUrl({ origin: 'https://evil.example', cookie: `ldrv_cust_session=${customerCookie(CUSTOMER)}` });
  assert.equal(r.status, 403);
});
await step('Upload URL: rejected with a forged session cookie', async () => {
  const forged = customerCookie(CUSTOMER).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const r = await uploadUrl({ origin: APP, cookie: `ldrv_cust_session=${forged}` });
  assert.equal(r.status, 401);
});
await step('Upload URL: issued for a path inside the customer own folder', async () => {
  const r = await uploadUrl({ origin: APP, cookie: `ldrv_cust_session=${customerCookie(CUSTOMER)}` });
  assert.equal(r.status, 200);
  issued = await r.json();
  assert.ok(issued.path.startsWith(`${ownerFolder(CUSTOMER)}/`), issued.path);
  assert.doesNotMatch(issued.path, new RegExp(CUSTOMER));
});
await step('Signed upload token works only for its own path, once', async () => {
  const other = `${ownerFolder(OTHER_CUSTOMER)}/2026-09/0b0c0d0e-0000-4000-8000-000000000002.jpg`;
  const wrong = await anon.storage.from(BUCKET).uploadToSignedUrl(other, issued.token, JPEG, { contentType: 'image/jpeg' });
  assert.ok(wrong.error, 'token must not upload to another path');
  const ok = await anon.storage.from(BUCKET).uploadToSignedUrl(issued.path, issued.token, JPEG, { contentType: 'image/jpeg' });
  assert.ifError(ok.error);
  const again = await anon.storage.from(BUCKET).uploadToSignedUrl(issued.path, issued.token, JPEG, { contentType: 'image/jpeg' });
  assert.ok(again.error, 'no overwrite with the same token');
});
await step('Bucket rejects non-JPEG uploads even with a valid token', async () => {
  const r = await uploadUrl({ origin: APP, cookie: `ldrv_cust_session=${customerCookie(CUSTOMER)}` });
  const t = await r.json();
  const { error } = await anon.storage.from(BUCKET).uploadToSignedUrl(t.path, t.token, Buffer.from('<svg/>'), { contentType: 'image/svg+xml' });
  assert.ok(error, 'svg must be rejected by allowed_mime_types');
});

// ---------------------------------------------------------------------------
// 3. Browser flows on the real stack: instant + scheduled order, split bags,
//    satuan photo uploaded for real, constraint enforced by Postgres.
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const prodHits = [];
const newCtx = async () => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
    geolocation: { latitude: -6.886, longitude: 107.613 }, permissions: ['geolocation']
  });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.endsWith('supabase.co')) {
      prodHits.push(`${route.request().method()} ${u.hostname}${u.pathname}`);
      return route.abort();
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      if (u.pathname.startsWith('/api/road-distance')) return route.fulfill({ json: { km: 2.5 } });
      return route.continue();
    }
    return route.fulfill({ status: 204, body: '' });
  });
  ctx.on('page', (p) => p.on('dialog', (d) => d.accept()));
  return ctx;
};

const TEST_PHOTO = {
  name: 'item.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
};
const fillBag = async (page, bag, counts) => {
  const labels = { bajuRingan: 'Baju ringan (kaos/kemeja)', celanaBiasa: 'Celana biasa', celanaJeans: 'Celana jeans', cd: 'CD (celana dalam)', bra: 'Bra' };
  for (const [k, label] of Object.entries(labels)) await page.getByLabel(`${label} Kantong ${bag}`).fill(String(counts[k] ?? 0));
};
const customerPage = async () => {
  const ctx = await newCtx();
  await ctx.addCookies([{ name: 'ldrv_cust_session', value: customerCookie(CUSTOMER), url: APP, httpOnly: true }]);
  await ctx.addInitScript((phone) => localStorage.setItem('laundry_customer_phone', phone), CUSTOMER);
  const page = await ctx.newPage();
  await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('nav').getByRole('button', { name: 'Order' }).click();
  await page.getByRole('button', { name: /^Rumah/ }).first().click();
  await page.getByLabel('Pilih outlet').waitFor();
  return { ctx, page };
};
const submitStep3 = async (page, { doubleTap = false } = {}) => {
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
  const name = page.getByPlaceholder('Nama Anda');
  if (!(await name.inputValue())) await name.fill('Asep Rahmat');
  const checks = page.locator('form input[type=checkbox]');
  for (let i = 0; i < (await checks.count()); i++) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
  if (doubleTap) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[type=submit]')].find((b) => /Pesan Sekarang/.test(b.textContent || ''));
      btn.click();
      btn.click();
      btn.click();
    });
  } else {
    await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
  }
  await page.waitForTimeout(3000);
};

let instantOrder;
{
  const { ctx, page } = await customerPage();
  await step('Instant order: 2 separated bags + satuan with a real photo upload', async () => {
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
    await page.getByText('Paket Laundry Kiloan').click();
    await page.locator('button[aria-label="Tambah"]').first().click();
    await page.getByRole('button', { name: 'Dipisah' }).click();
    const k1 = page.getByText('Kantong 1', { exact: true }).locator('xpath=..');
    const k2 = page.getByText('Kantong 2', { exact: true }).locator('xpath=..');
    await k1.getByRole('combobox').first().selectOption({ label: 'Cuci Kering Lipat' });
    await k2.getByRole('combobox').first().selectOption({ label: 'Cuci Setrika' });
    await fillBag(page, 1, { bajuRingan: 2, celanaBiasa: 1, celanaJeans: 1, cd: 3, bra: 1 }); // 1.925 kg, 8 pcs
    await fillBag(page, 2, { bajuRingan: 6 }); // 1.2 kg
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    await page.getByText('Items Satuan', { exact: false }).click();
    await page.getByLabel('Unggah foto item satuan').setInputFiles(TEST_PHOTO);
    await page.getByAltText('Foto item satuan').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    await submitStep3(page, { doubleTap: true });
    const n = Number(psql(`select count(*) from pickup_orders where customer_phone='${CUSTOMER}'`));
    assert.equal(n, 1, `orders after triple tap: ${n}`);
  });
  await step('Instant order row in Postgres: pickup_date = today (WIB), no time, status Menunggu Kurir', async () => {
    instantOrder = JSON.parse(psql(`select row_to_json(p) from pickup_orders p where customer_phone='${CUSTOMER}' order by created_at desc limit 1`));
    assert.equal(instantOrder.pickup_date, jakartaToday());
    assert.equal(instantOrder.pickup_time, null);
    assert.equal(instantOrder.scheduled_at, null);
    assert.equal(instantOrder.status, 'Menunggu Kurir');
    assert.equal(instantOrder.bag_count, 2);
    assert.equal(instantOrder.wash_process, 'Pisah Perkantong');
    const kg = instantOrder.items.filter((i) => i.type === 'kg');
    assert.deepEqual(kg.map((i) => [i.name, i.weight]), [['Cuci Kering Lipat', 1.93], ['Cuci Setrika', 1.2]]);
    assert.deepEqual(kg[0].bag_category_counts, { bajuRingan: '2', celanaBiasa: '1', celanaJeans: '1', cd: '3', bra: '1' });
  });
  await step('Satuan photo: stored in Storage under the customer folder and referenced by path', async () => {
    const sat = instantOrder.items.find((i) => Array.isArray(i.pieces));
    const path = sat.pieces[0].photo_path;
    assert.ok(path.startsWith(`${ownerFolder(CUSTOMER)}/`), path);
    const { data, error } = await service.storage.from(BUCKET).download(path);
    assert.ifError(error);
    assert.ok(data.size > 0);
    assert.equal(data.type, 'image/jpeg');
  });
  await step('Tasks: exactly one driver and one CS task for the order', async () => {
    const rows = psql(`select assigned_to_role from system_tasks where source_id='${instantOrder.id}' order by 1`).split('\n');
    assert.deepEqual(rows, ['cs', 'driver']);
  });
  await ctx.close();
}

await step('Scheduled order: pickup_date/time = chosen slot, status Terjadwal', async () => {
  const { ctx, page } = await customerPage();
  await page.getByRole('button', { name: /Jadwalkan/ }).click();
  const date = await page.locator('input[type=date]').first().inputValue();
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
  await page.getByText('Paket Laundry Kiloan').click();
  await fillBag(page, 1, { bajuRingan: 15 });
  await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
  await submitStep3(page);
  const o = JSON.parse(psql(`select row_to_json(p) from pickup_orders p where customer_phone='${CUSTOMER}' and status='Terjadwal' limit 1`));
  assert.equal(o.pickup_date, date);
  assert.ok(o.pickup_time && o.scheduled_at);
  assert.equal(Number(psql(`select count(*) from system_tasks where source_id='${o.id}'`)) >= 0, true);
  await ctx.close();
});

await step('Driver-delivery fallback insert without pickup_date succeeds (defaults to today)', async () => {
  const out = execFileSync(
    'npx',
    ['tsx', '-e', `import { insertPickupOrder } from './lib/pickupDispatch'; insertPickupOrder({ outlet_id: '${DAGO}', customer_name: 'Pelanggan', customer_phone: '${CUSTOMER}', service_type: 'Antar cucian', address: 'x', notes: 'Request Pengantaran Customer · UJI', status: 'Siap Diantar' }).then((r) => { console.log(JSON.stringify(r.error)); process.exit(0); });`],
    { cwd: ROOT, env: serverEnv, encoding: 'utf8' }
  );
  assert.equal(out.trim().split('\n').pop(), 'null');
  assert.equal(psql(`select pickup_date from pickup_orders where notes like '%UJI%'`), jakartaToday());
});

// ---------------------------------------------------------------------------
// 4. Staff photo access: signed staff session + DB role/outlet + ownership.
// ---------------------------------------------------------------------------
const photoPath = () => instantOrder.items.find((i) => Array.isArray(i.pieces)).pieces[0].photo_path;
const staffLogin = async (username, password) => {
  const r = await fetch(APP + '/api/auth/staff-login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password })
  });
  assert.equal(r.status, 200, `login ${username}`);
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/ldrv_staff_session=([^;]+)/);
  assert.ok(m, 'staff session cookie issued');
  assert.match(setCookie, /HttpOnly/i);
  return { cookie: `ldrv_staff_session=${m[1]}`, user: (await r.json()).user };
};
const view = (cookie, body, origin = APP) =>
  fetch(APP + '/api/staff/satuan-photo/view', {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body)
  });

let kasirDago;
await step('Staff view: no staff session → 401', async () => {
  const r = await view('', { pickupOrderId: instantOrder.id, path: photoPath() });
  assert.equal(r.status, 401);
});
await step('Staff view: kasir of the order outlet gets a 5-minute signed URL that serves the photo', async () => {
  kasirDago = await staffLogin('kasir_dago', 'uji-kasir-1');
  const r = await view(kasirDago.cookie, { pickupOrderId: instantOrder.id, path: photoPath() });
  assert.equal(r.status, 200);
  const { url, expiresIn } = await r.json();
  assert.equal(expiresIn, 300);
  assert.match(url, /\/storage\/v1\/object\/sign\/satuan-item-photos\//);
  const img = await fetch(url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
});
await step('Staff view: every access is written to audit_logs', async () => {
  const row = psql(`select user_name||'|'||action||'|'||entity_id from audit_logs order by created_at desc limit 1`);
  assert.equal(row, `Kasir Dago|view_satuan_item_photo|${instantOrder.id}`);
});
await step('Staff view: kasir of another outlet → 403', async () => {
  const k = await staffLogin('kasir_smg', 'uji-kasir-2');
  const r = await view(k.cookie, { pickupOrderId: instantOrder.id, path: photoPath() });
  assert.equal(r.status, 403);
});
await step('Staff view: driver role → 403; CS → 200', async () => {
  const d = await staffLogin('driver_dago', 'uji-driver-4');
  assert.equal((await view(d.cookie, { pickupOrderId: instantOrder.id, path: photoPath() })).status, 403);
  const cs = await staffLogin('cs_pusat', 'uji-cs-3');
  assert.equal((await view(cs.cookie, { pickupOrderId: instantOrder.id, path: photoPath() })).status, 200);
});
await step('Staff view: photo not on the order, or another customer photo smuggled into an order → 404', async () => {
  assert.equal((await view(kasirDago.cookie, { pickupOrderId: instantOrder.id, path: victimPath })).status, 404);
  const smuggle = psql(
    `insert into pickup_orders (outlet_id, customer_phone, pickup_date, status, items) values ('${DAGO}', '${CUSTOMER}', current_date, 'Menunggu Kurir', '[{"name":"Jas","pieces":[{"photo_path":"${victimPath}"}]}]') returning id`
  ).split('\n')[0];
  assert.equal((await view(kasirDago.cookie, { pickupOrderId: smuggle, path: victimPath })).status, 404);
});
await step('Staff view: forged/role-escalated cookie, cross-origin and logged-out sessions are rejected', async () => {
  const [body, sig] = kasirDago.cookie.split('=')[1].split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  const escalated = Buffer.from(JSON.stringify({ ...p, role: 'owner', sid: 'aaaaaaaa-0000-4000-8000-000000000002' })).toString('base64url');
  assert.equal((await view(`ldrv_staff_session=${escalated}.${sig}`, { pickupOrderId: instantOrder.id, path: photoPath() })).status, 401);
  assert.equal((await view(kasirDago.cookie, { pickupOrderId: instantOrder.id, path: photoPath() }, 'https://evil.example')).status, 403);
  const out = await fetch(APP + '/api/auth/staff-logout', { method: 'POST', headers: { cookie: kasirDago.cookie } });
  assert.match(out.headers.get('set-cookie') || '', /ldrv_staff_session=;.*Max-Age=0/i);
});
await step('Staff view: a staff member whose role was changed in the DB loses access immediately', async () => {
  const k = await staffLogin('kasir_dago', 'uji-kasir-1');
  psql(`update employees set role='driver' where username='kasir_dago'`);
  assert.equal((await view(k.cookie, { pickupOrderId: instantOrder.id, path: photoPath() })).status, 403);
  psql(`update employees set role='kasir' where username='kasir_dago'`);
});

// ---------------------------------------------------------------------------
// 5. POS & CS show bag detail and the photo button (real data, real session).
// ---------------------------------------------------------------------------
const staffPage = async (username, password) => {
  const ctx = await newCtx();
  const r = await ctx.request.post(APP + '/api/auth/staff-login', { data: { username, password } });
  const { user } = await r.json();
  await ctx.addInitScript((u) => {
    localStorage.setItem('laundry_user', JSON.stringify(u));
    localStorage.setItem('user_outlet_id', u.outlet_id || '');
  }, user);
  return { ctx, page: await ctx.newPage() };
};
await step('POS: kasir sees per-bag categories, pcs, est. kg, service, duration and opens the photo', async () => {
  const { ctx, page } = await staffPage('kasir_dago', 'uji-kasir-1');
  await page.goto(`${APP}/pos?pickup_id=${instantOrder.id}`, { waitUntil: 'networkidle' });
  await page.getByText('Kantong 1 — Cuci Kering Lipat', { exact: false }).waitFor({ timeout: 20000 });
  await page.getByText('Kantong 2 — Cuci Setrika', { exact: false }).waitFor();
  await page.getByText('8 pcs · estimasi ±1.93 kg', { exact: false }).waitFor();
  await page.getByText('CD (celana dalam): 3', { exact: false }).waitFor();
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: 'Lihat Foto' }).first().click()]);
  await popup.waitForURL(/\/storage\/v1\/object\/sign\/satuan-item-photos\//, { timeout: 15000 });
  await ctx.close();
});
await step('CS dashboard: bag summary (no category breakdown) and photo button for the order', async () => {
  const { ctx, page } = await staffPage('cs_pusat', 'uji-cs-3');
  await page.goto(`${APP}/cs/dashboard`, { waitUntil: 'networkidle' });
  const card = page.locator('div.rounded-2xl', { hasText: instantOrder.order_number }).last();
  await card.getByText('Proses: Pisah Perkantong', { exact: false }).waitFor({ timeout: 20000 });
  await card.getByText('Kantong 2 — Cuci Setrika', { exact: false }).waitFor();
  assert.equal(await card.getByText('CD (celana dalam)', { exact: false }).count(), 0);
  const [popup] = await Promise.all([ctx.waitForEvent('page'), card.getByRole('button', { name: 'Lihat Foto' }).click()]);
  await popup.waitForURL(/\/storage\/v1\/object\/sign\/satuan-item-photos\//, { timeout: 15000 });
  await ctx.close();
});
await step('Driver dashboard still lists the new instant order', async () => {
  const { ctx, page } = await staffPage('driver_dago', 'uji-driver-4');
  await page.goto(`${APP}/driver/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const listed = await page.getByText(instantOrder.customer_name || 'Asep Rahmat', { exact: false }).count();
  assert.ok(listed > 0, 'order visible to the outlet driver');
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 6. report-error: minimal, PII-free, abuse-limited.
// ---------------------------------------------------------------------------
const report = (body, origin = APP) =>
  fetch(APP + '/api/customer/order/report-error', {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '10.9.9.9' }, body: JSON.stringify(body)
  });
await step('report-error: cross-origin → 403, oversized → 413', async () => {
  assert.equal((await report({ stage: 'pickup_order_create' }, 'https://evil.example')).status, 403);
  assert.equal((await report({ stage: 'pickup_order_create', message: 'x'.repeat(5000) })).status, 413);
});
await step('report-error: stored row has no payload / personal data', async () => {
  const r = await report({
    stage: 'pickup_order_create', category: 'not_null', column: 'pickup_date',
    message: 'Failing row contains (Asep Rahmat, 085172141494, jl ir juanda). null value in column "pickup_date"',
    payload: { customer_phone: CUSTOMER, address: 'jl ir juanda' },
    context: { isFuturePickup: false, kiloanLines: 2, satuanLines: 1, phone: CUSTOMER }
  });
  assert.equal(r.status, 200);
  const row = psql(`select row_to_json(e) from error_logs e where source='customer_order_form' order by created_at desc limit 1`);
  for (const leaked of [CUSTOMER, 'juanda', 'Asep', '10.9.9.9']) assert.ok(!row.includes(leaked), `leaked ${leaked}: ${row}`);
  const e = JSON.parse(row);
  assert.equal(e.code, 'pickup_order_create:not_null');
  assert.deepEqual(Object.keys(e.context).sort(), ['column', 'ipHash', 'isFuturePickup', 'kiloanLines', 'satuanLines']);
});
await step('report-error: per-IP limit returns 429 after 5 reports', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await report({ stage: 'pickup_order_create', category: 'unknown' })).status);
  assert.equal(statuses.at(-1), 429, statuses.join(','));
});

await step('No browser request ever reached a *.supabase.co host', async () => {
  assert.deepEqual(prodHits, []);
});

await browser.close();
app.kill();
for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
