/**
 * PR #5 end-to-end tests against the real STAGING Supabase project.
 * Separate from scripts/e2e/local-supabase (whose localhost guard is untouched).
 *
 *   # build the app against staging (a development build: production is refused)
 *   NEXT_PUBLIC_SUPABASE_URL=$STAGING_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$STAGING_SUPABASE_ANON_KEY npm run build
 *   npx tsx scripts/e2e/staging/run.ts
 *
 * Safety:
 * - scripts/staging/guard.ts must accept the env (staging ref only, never
 *   production), and staging itself must accept both keys — before anything.
 * - The local app's /api/health/db-target?verify=1 must report
 *   readyForStagingTests with the staging ref, or the run aborts.
 * - Browser requests to the production host are aborted and fail the run.
 * - Only synthetic fixtures from scripts/staging/seed.sql are used; staff
 *   passwords are random per run and never printed.
 *
 * --selftest-local runs the same steps against a LOCAL Supabase stack to
 * exercise the runner itself. Its output is never a staging result.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { hashStaffPassword } from '../../../lib/staffPassword';
import { PRODUCTION_SUPABASE_REF } from '../../../lib/supabaseTarget';
import { loadStagingEnv, verifyStagingKeys, type StagingEnv } from '../../staging/guard';

const ROOT = join(__dirname, '..', '..', '..');
const selftest = process.argv.includes('--selftest-local');
const PORT = Number(process.env.STAGING_E2E_PORT || 3302);
const APP = `http://localhost:${PORT}`;

const SYN = {
  customer: '080000000001',
  otherCustomer: '080000000002',
  outletA: 'e5e50000-0000-4000-8000-00000000000a',
  /** Synthetic staff by username; ids are assigned by the database (employees.id is bigint in production). */
  staff: {
    kasirA: { username: 'stg_kasir_a' },
    kasirB: { username: 'stg_kasir_b' },
    cs: { username: 'stg_cs' },
    driverA: { username: 'stg_driver_a' }
  }
} as const;
type StaffKey = keyof typeof SYN.staff;
/** employees.id of each synthetic staff member, as text; filled from the database before the tests. */
const staffId = {} as Record<StaffKey, string>;

const loadEnv = (): StagingEnv => {
  if (!selftest) return loadStagingEnv({ needDb: false });
  const url = String(process.env.LOCAL_SB_URL || '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('[selftest-local] LOCAL_SB_URL must be local.');
  return { ref: 'local', url, anonKey: String(process.env.LOCAL_SB_ANON || ''), serviceKey: String(process.env.LOCAL_SB_SERVICE || ''), dbUrl: '' };
};

/**
 * Insert one synthetic row to learn why an app write failed (the app helpers
 * ignore insert errors), then delete it again. Returns the PostgREST error
 * code + message, or "ok".
 */
async function probeInsert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await client.from(table).insert(row).select('id');
  if (error) return `${error.code ?? ''} ${error.message}`.trim();
  const ids = (data || []).map((r: { id: unknown }) => r.id);
  if (ids.length) await client.from(table).delete().in('id', ids);
  return 'ok (row inserted and removed)';
}

const results: Array<[string, string, string?]> = [];
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    // Assertion values here are synthetic staging data (roles, ids, flags) — safe to print.
    const err = e as Error & { actual?: unknown; expected?: unknown; code?: string };
    const brief = (v: unknown) => JSON.stringify(v)?.slice(0, 240);
    const detail = err?.code === 'ERR_ASSERTION' && 'actual' in err ? ` | actual=${brief(err.actual)} expected=${brief(err.expected)}` : '';
    results.push(['FAIL', name, String(err?.message || e).split('\n')[0] + detail]);
  }
  const last = results[results.length - 1];
  console.log(`${last[0]} | ${last[1]}${last[2] ? ` | ${last[2]}` : ''}`);
};

const bundleReferences = (needle: string): boolean => {
  const stack = [join(ROOT, '.next/static/chunks')];
  while (stack.length) {
    const d = stack.pop() as string;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (name.endsWith('.js') && readFileSync(p, 'utf8').includes(needle)) return true;
    }
  }
  return false;
};

async function main() {
  // --- 0. guard -----------------------------------------------------------
  let s: StagingEnv;
  try {
    s = loadEnv();
    if (!selftest) await verifyStagingKeys(s);
  } catch (e) {
    console.error(`ABORT | ${(e as Error).message}`);
    process.exit(2);
  }
  console.log(`target: ${selftest ? 'LOCAL SELFTEST (not a staging result)' : `staging ${s.ref}`}`);
  if (!bundleReferences(s.url)) {
    console.error(`ABORT | build does not reference ${selftest ? s.url : 'the staging URL'}; rebuild with NEXT_PUBLIC_SUPABASE_URL/ANON_KEY = staging.`);
    process.exit(2);
  }

  const CUSTOMER_AUTH_SECRET = randomBytes(32).toString('hex');
  const STAFF_SESSION_SECRET = randomBytes(32).toString('hex');
  // Per-run secret for the payment endpoint under test (never a real secret).
  const PAYMENT_OPS_SECRET = randomBytes(24).toString('hex');
  const app: ChildProcess = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    env: {
      ...process.env,
      SUPABASE_URL: s.url,
      SUPABASE_SERVICE_ROLE_KEY: s.serviceKey,
      CUSTOMER_AUTH_SECRET,
      STAFF_SESSION_SECRET,
      SATUAN_ITEM_PHOTO_ENABLED: 'true',
      PAYMENT_OPS_SECRET
    }
  });
  const stop = (code: number) => {
    app.kill();
    process.exit(code);
  };
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(APP + '/api/health/db-target');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await step('db-target: app proven to use the staging project and staging accepts both keys', async () => {
    const r = await (await fetch(APP + '/api/health/db-target?verify=1')).json();
    const expectRef = selftest ? r.server.projectRef : s.ref;
    assert.equal(r.safeForTesting, true, 'safeForTesting');
    assert.equal(r.browser.projectRef, expectRef);
    assert.equal(r.server.projectRef, expectRef);
    assert.notEqual(r.server.projectRef, PRODUCTION_SUPABASE_REF);
    assert.equal(r.verify?.readyForStagingTests, true, JSON.stringify(r.verify));
  });
  if (results[results.length - 1][0] !== 'PASS') {
    console.error('ABORT | database target not proven — no test was run.');
    stop(2);
  }

  const anon = createClient(s.url, s.anonKey, { auth: { persistSession: false } });
  const service = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const BUCKET = 'satuan-item-photos';
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  const runStart = new Date(Date.now() - 5000).toISOString();
  const uploaded: string[] = [];
  const jakartaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const customerCookie = (phone: string) => {
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ v: 1, phone, method: 'whatsapp', iat: now, exp: now + 3600 })).toString('base64url');
    const sig = createHmac('sha256', CUSTOMER_AUTH_SECRET).update(`session\u0000${body}`).digest('base64url');
    return `${body}.${sig}`;
  };
  const ownerFolder = (phone: string) =>
    createHmac('sha256', CUSTOMER_AUTH_SECRET).update(`satuan-photo-owner\u0000${phone}`).digest('hex').slice(0, 32);
  const month = new Date().toISOString().slice(0, 7);

  // Random per-run staff passwords (hashed in DB, kept only in memory).
  const passwords = {} as Record<StaffKey, string>;
  for (const key of Object.keys(SYN.staff) as StaffKey[]) {
    const found = await service.from('employees').select('id').eq('username', SYN.staff[key].username);
    if (found.error || found.data?.length !== 1) {
      console.error(`ABORT | synthetic staff ${SYN.staff[key].username} not found exactly once (${found.error?.message ?? `${found.data?.length ?? 0} rows`}). Run scripts/staging/prepare.ts first.`);
      stop(2);
    }
    staffId[key] = String(found.data![0].id);
    passwords[key] = randomBytes(18).toString('base64url');
    const { error } = await service.from('employees').update({ password: hashStaffPassword(passwords[key]) }).eq('id', staffId[key]);
    if (error) {
      console.error(`ABORT | cannot set synthetic staff credentials (${error.message}). Run scripts/staging/prepare.ts first.`);
      stop(2);
    }
  }
  // Driver A on duty at outlet A so the driver queue shows its pickups.
  await service.from('driver_attendance').delete().eq('driver_id', staffId.driverA);
  await service.from('driver_attendance').insert({
    driver_id: staffId.driverA,
    driver_name: '[STAGING] Driver A',
    active_outlet_id: SYN.outletA,
    clock_in_at: new Date().toISOString(),
    status: 'ON_DUTY'
  });

  const victimPath = `${ownerFolder(SYN.otherCustomer)}/${month}/${randomUUID()}.jpg`;
  {
    const { error } = await service.storage.from(BUCKET).upload(victimPath, JPEG, { contentType: 'image/jpeg' });
    if (error) {
      console.error(`ABORT | cannot prepare fixture photo (${error.message}).`);
      stop(2);
    }
    uploaded.push(victimPath);
  }

  // --- 1. storage lock-down -------------------------------------------------
  await step('Anon key cannot list the photo bucket', async () => {
    const { data, error } = await anon.storage.from(BUCKET).list(`${ownerFolder(SYN.otherCustomer)}/${month}`);
    assert.ok(error || (Array.isArray(data) && data.length === 0), `anon listed ${data?.length} objects`);
  });
  await step('Anon key cannot download / sign / publicly fetch another customer photo', async () => {
    assert.ok((await anon.storage.from(BUCKET).download(victimPath)).error, 'download');
    const signed = await anon.storage.from(BUCKET).createSignedUrl(victimPath, 60);
    assert.ok(signed.error || !signed.data?.signedUrl, 'sign');
    assert.notEqual((await fetch(`${s.url}/storage/v1/object/public/${BUCKET}/${victimPath}`)).status, 200, 'public');
  });
  await step('Anon key cannot upload directly into the bucket', async () => {
    const { error } = await anon.storage.from(BUCKET).upload(`${ownerFolder(SYN.customer)}/${month}/${randomUUID()}.jpg`, JPEG, { contentType: 'image/jpeg' });
    assert.ok(error);
  });

  // --- 2. customer upload URL ----------------------------------------------
  const uploadUrl = (headers: Record<string, string>) =>
    fetch(APP + '/api/customer/satuan-photo/upload-url', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  await step('Upload URL: 401 without session, 403 cross-origin, 401 forged cookie', async () => {
    assert.equal((await uploadUrl({ origin: APP })).status, 401);
    assert.equal((await uploadUrl({ origin: 'https://evil.example', cookie: `ldrv_cust_session=${customerCookie(SYN.customer)}` })).status, 403);
    const forged = customerCookie(SYN.customer).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await uploadUrl({ origin: APP, cookie: `ldrv_cust_session=${forged}` })).status, 401);
  });
  await step('Upload URL: token only for its own path in the customer folder, once; JPEG only', async () => {
    const r = await uploadUrl({ origin: APP, cookie: `ldrv_cust_session=${customerCookie(SYN.customer)}` });
    assert.equal(r.status, 200);
    const t = (await r.json()) as { path: string; token: string };
    assert.ok(t.path.startsWith(`${ownerFolder(SYN.customer)}/`));
    const other = `${ownerFolder(SYN.otherCustomer)}/${month}/${randomUUID()}.jpg`;
    assert.ok((await anon.storage.from(BUCKET).uploadToSignedUrl(other, t.token, JPEG, { contentType: 'image/jpeg' })).error, 'other path');
    assert.ifError((await anon.storage.from(BUCKET).uploadToSignedUrl(t.path, t.token, JPEG, { contentType: 'image/jpeg' })).error);
    uploaded.push(t.path);
    assert.ok((await anon.storage.from(BUCKET).uploadToSignedUrl(t.path, t.token, JPEG, { contentType: 'image/jpeg' })).error, 'overwrite');
    const r2 = (await (await uploadUrl({ origin: APP, cookie: `ldrv_cust_session=${customerCookie(SYN.customer)}` })).json()) as { path: string; token: string };
    assert.ok((await anon.storage.from(BUCKET).uploadToSignedUrl(r2.path, r2.token, Buffer.from('<svg/>'), { contentType: 'image/svg+xml' })).error, 'svg');
  });

  // --- 3. browser flows ------------------------------------------------------
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const prodHits: string[] = [];
  const newCtx = async (): Promise<BrowserContext> => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta',
      geolocation: { latitude: -6.886, longitude: 107.613 }, permissions: ['geolocation']
    });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname.startsWith(`${PRODUCTION_SUPABASE_REF}.`)) {
        prodHits.push(`${route.request().method()} ${u.pathname}`);
        return route.abort();
      }
      if (u.pathname.startsWith('/api/road-distance')) return route.fulfill({ json: { km: 2.5 } });
      return route.continue();
    });
    ctx.on('page', (p) => p.on('dialog', (d) => d.accept()));
    return ctx;
  };
  const TEST_PHOTO = {
    name: 'item.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  };
  const labels: Record<string, string> = {
    bajuRingan: 'Baju ringan (kaos/kemeja)', celanaBiasa: 'Celana biasa', celanaJeans: 'Celana jeans', cd: 'CD (celana dalam)', bra: 'Bra'
  };
  const fillBag = async (page: Page, bag: number, counts: Record<string, number>) => {
    for (const [k, label] of Object.entries(labels)) await page.getByLabel(`${label} Kantong ${bag}`).fill(String(counts[k] ?? 0));
  };
  const customerPage = async () => {
    const ctx = await newCtx();
    await ctx.addCookies([{ name: 'ldrv_cust_session', value: customerCookie(SYN.customer), url: APP, httpOnly: true }]);
    await ctx.addInitScript((phone) => localStorage.setItem('laundry_customer_phone', phone), SYN.customer);
    const page = await ctx.newPage();
    await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.locator('nav').getByRole('button', { name: 'Order' }).click();
    await page.getByRole('button', { name: /^Rumah/ }).first().click();
    await page.getByLabel('Pilih outlet').selectOption(SYN.outletA);
    return { ctx, page };
  };
  const submit = async (page: Page, tripleTap = false) => {
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
    const name = page.getByPlaceholder('Nama Anda');
    if (!(await name.inputValue())) await name.fill('[STAGING] Pelanggan Uji');
    const checks = page.locator('form input[type=checkbox]');
    for (let i = 0; i < (await checks.count()); i++) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
    if (tripleTap) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button[type=submit]')].find((b) => /Pesan Sekarang/.test(b.textContent || '')) as HTMLButtonElement;
        btn.click();
        btn.click();
        btn.click();
      });
    } else {
      await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
    }
    await page.waitForTimeout(4000);
  };
  const ordersThisRun = async () =>
    ((await service.from('pickup_orders').select('*').eq('customer_phone', SYN.customer).gte('created_at', runStart).order('created_at')).data ||
      []) as Array<Record<string, unknown>>;

  let instant: Record<string, unknown> | undefined;
  {
    const { ctx, page } = await customerPage();
    await step('Instant order: 2 separated bags + satuan with a real photo upload, triple tap → 1 order', async () => {
      if (process.env.STAGING_E2E_SHOTS) await page.screenshot({ path: `${process.env.STAGING_E2E_SHOTS}/order-step1.png`, fullPage: true });
      await page.getByRole('button', { name: /Lanjut/ }).click();
      await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
      await page.getByText('Paket Laundry Kiloan').click();
      await page.locator('button[aria-label="Tambah"]').first().click();
      await page.getByRole('button', { name: 'Dipisah' }).click();
      await page.getByText('Kantong 1', { exact: true }).locator('xpath=..').getByRole('combobox').first().selectOption({ label: 'Cuci Kering Lipat' });
      await page.getByText('Kantong 2', { exact: true }).locator('xpath=..').getByRole('combobox').first().selectOption({ label: 'Cuci Setrika' });
      await fillBag(page, 1, { bajuRingan: 2, celanaBiasa: 1, celanaJeans: 1, cd: 3, bra: 1 });
      await fillBag(page, 2, { bajuRingan: 6 });
      await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
      await page.getByText('Items Satuan', { exact: false }).click();
      await page.getByLabel('Unggah foto item satuan').setInputFiles(TEST_PHOTO);
      await page.getByAltText('Foto item satuan').waitFor({ timeout: 20000 });
      await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
      await submit(page, true);
      const rows = await ordersThisRun();
      assert.equal(rows.length, 1, `orders after triple tap: ${rows.length}`);
      instant = rows[0];
    });
    await step('Instant order row: pickup_date = today WIB, no time, status Menunggu Kurir, per-bag detail stored', async () => {
      assert.ok(instant);
      assert.equal(String(instant.pickup_date).slice(0, 10), jakartaToday());
      assert.equal(instant.pickup_time ?? null, null);
      assert.equal(instant.status, 'Menunggu Kurir');
      const items = instant.items as Array<Record<string, unknown>>;
      const kg = items.filter((i) => i.type === 'kg');
      assert.deepEqual(kg.map((i) => [i.name, i.weight]), [['Cuci Kering Lipat', 1.93], ['Cuci Setrika', 1.2]]);
      assert.deepEqual(kg[0].bag_category_counts, { bajuRingan: '2', celanaBiasa: '1', celanaJeans: '1', cd: '3', bra: '1' });
    });
    await step('Satuan photo stored privately under the customer folder', async () => {
      const sat = (instant?.items as Array<{ pieces?: Array<{ photo_path?: string }> }>).find((i) => Array.isArray(i.pieces));
      const path = String(sat?.pieces?.[0]?.photo_path || '');
      assert.ok(path.startsWith(`${ownerFolder(SYN.customer)}/`), path);
      uploaded.push(path);
      const { data, error } = await service.storage.from(BUCKET).download(path);
      assert.ifError(error);
      assert.ok((data?.size || 0) > 0);
    });
    await step('Exactly one driver task and one CS task for the order', async () => {
      // Read like the CS/driver dashboards do (anon client): in the production ACL
      // service_role has no privileges on system_tasks.
      const { data, error: readErr } = await anon.from('system_tasks').select('assigned_to_role').eq('source_id', String(instant?.id));
      assert.ifError(readErr);
      const roles = (data || []).map((t) => t.assigned_to_role).sort();
      if (roles.join() !== 'cs,driver') {
        // Why: the app inserts the full task with the ANON client and silently falls back to
        // smaller payloads (without source_id). Replay the full payload the same way.
        const probe = await probeInsert(anon, 'system_tasks', {
          title: 'Pickup online — [STAGING] probe', description: '[STAGING] probe', assigned_to_role: 'cs', sla_hours: 2,
          due_date: new Date().toISOString(), kpi_penalty_points: 5, status: 'pending', source_type: 'PICKUP', source_id: instant?.id
        });
        const unlinked = await anon.from('system_tasks').select('*').ilike('title', '%[STAGING] Pelanggan Uji%').limit(5);
        const shape = (unlinked.data || []).map((r) => `${r.assigned_to_role}:source_id=${r.source_id ?? 'null'}`).join(',') || unlinked.error?.message || 'none';
        assert.fail(`tasks linked to order ${instant?.id}: [${roles}]; full-payload insert (anon): ${probe}; tasks by title: ${shape}`);
      }
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
    await submit(page);
    const o = (await ordersThisRun()).find((r) => r.status === 'Terjadwal');
    assert.ok(o, 'scheduled order saved');
    assert.equal(String(o.pickup_date).slice(0, 10), date);
    assert.ok(o.pickup_time && o.scheduled_at);
    await ctx.close();
  });

  // --- 4. staff photo access -------------------------------------------------
  const photoPath = () =>
    String((instant?.items as Array<{ pieces?: Array<{ photo_path?: string }> }>).find((i) => Array.isArray(i.pieces))?.pieces?.[0]?.photo_path || '');
  const login = async (key: StaffKey) => {
    const r = await fetch(APP + '/api/auth/staff-login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: SYN.staff[key].username, password: passwords[key] })
    });
    assert.equal(r.status, 200, `login ${key}`);
    const m = (r.headers.get('set-cookie') || '').match(/ldrv_staff_session=([^;]+)/);
    assert.ok(m, 'staff session cookie');
    return `ldrv_staff_session=${m[1]}`;
  };
  const view = (cookie: string, body: Record<string, unknown>, origin = APP) =>
    fetch(APP + '/api/staff/satuan-photo/view', {
      method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body)
    });
  const body = () => ({ pickupOrderId: String(instant?.id), path: photoPath() });

  await step('Staff view: 401 without session; kasir of the outlet gets a 5-min URL that serves the photo', async () => {
    assert.equal((await view('', body())).status, 401);
    const r = await view(await login('kasirA'), body());
    assert.equal(r.status, 200);
    const { url, expiresIn } = (await r.json()) as { url: string; expiresIn: number };
    assert.equal(expiresIn, 300);
    assert.equal((await fetch(url)).status, 200);
  });
  await step('Staff view is written to audit_logs', async () => {
    const { data } = await service.from('audit_logs').select('action, entity_id, user_id').eq('user_id', staffId.kasirA).order('created_at', { ascending: false }).limit(1);
    const row = data?.[0];
    if (!row) {
      // insertAuditLog ignores insert errors: replay its exact row shape with the service role.
      const probe = await probeInsert(service, 'audit_logs', {
        user_id: staffId.kasirA, user_name: '[STAGING] Kasir A', role: 'kasir', action: 'view_satuan_item_photo',
        entity_type: 'pickup_orders', entity_id: String(instant?.id), amount: null, meta: { path: '[STAGING] probe' }, ip_address: '127.0.0.1'
      });
      assert.fail(`no audit row for user_id ${staffId.kasirA}; same row via service role: ${probe}`);
    }
    assert.deepEqual({ ...row, user_id: String(row.user_id) }, { action: 'view_satuan_item_photo', entity_id: String(instant?.id), user_id: staffId.kasirA });
  });
  await step('Staff view: other-outlet kasir 403, driver 403, CS 200', async () => {
    assert.equal((await view(await login('kasirB'), body())).status, 403);
    assert.equal((await view(await login('driverA'), body())).status, 403);
    assert.equal((await view(await login('cs'), body())).status, 200);
  });
  await step('Staff view: photo not on the order / smuggled other-customer photo → 404', async () => {
    const kasir = await login('kasirA');
    assert.equal((await view(kasir, { pickupOrderId: String(instant?.id), path: victimPath })).status, 404);
    // Inserted with the ANON client, the same way the customer app creates orders
    // (production grants the pickup_order_seq sequence to anon/authenticated).
    const { data, error } = await anon
      .from('pickup_orders')
      .insert({ outlet_id: SYN.outletA, customer_phone: SYN.customer, customer_name: '[STAGING] smuggle', pickup_date: jakartaToday(), status: 'Menunggu Kurir', items: [{ name: 'Jas', pieces: [{ photo_path: victimPath }] }] })
      .select('id')
      .single();
    assert.ifError(error);
    assert.equal((await view(kasir, { pickupOrderId: String(data?.id), path: victimPath })).status, 404);
  });
  await step('Staff view: role-escalated cookie 401, cross-origin 403, role change in DB → 403', async () => {
    const kasir = await login('kasirA');
    const [b64, sig] = kasir.split('=')[1].split('.');
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString());
    const escalated = Buffer.from(JSON.stringify({ ...p, role: 'owner' })).toString('base64url');
    assert.equal((await view(`ldrv_staff_session=${escalated}.${sig}`, body())).status, 401);
    assert.equal((await view(kasir, body(), 'https://evil.example')).status, 403);
    await service.from('employees').update({ role: 'driver' }).eq('id', staffId.kasirA);
    try {
      assert.equal((await view(kasir, body())).status, 403);
    } finally {
      await service.from('employees').update({ role: 'kasir' }).eq('id', staffId.kasirA);
    }
  });

  // --- 5. POS / CS / driver UI ---------------------------------------------
  const staffPage = async (key: StaffKey) => {
    const ctx = await newCtx();
    const r = await ctx.request.post(APP + '/api/auth/staff-login', { data: { username: SYN.staff[key].username, password: passwords[key] } });
    const { user } = (await r.json()) as { user: Record<string, unknown> };
    await ctx.addInitScript((u) => {
      localStorage.setItem('laundry_user', JSON.stringify(u));
      localStorage.setItem('user_outlet_id', String(u.outlet_id || ''));
    }, user);
    return { ctx, page: await ctx.newPage() };
  };
  await step('POS: kasir sees per-bag categories, pcs, est. kg, service, duration and opens the photo', async () => {
    const { ctx, page } = await staffPage('kasirA');
    await page.goto(`${APP}/pos?pickup_id=${instant?.id}`, { waitUntil: 'networkidle' });
    await page.getByText('Kantong 1 — Cuci Kering Lipat', { exact: false }).waitFor({ timeout: 25000 });
    await page.getByText('8 pcs · estimasi ±1.93 kg', { exact: false }).waitFor();
    await page.getByText('CD (celana dalam): 3', { exact: false }).waitFor();
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: 'Lihat Foto' }).first().click()]);
    await popup.waitForURL(/\/storage\/v1\/object\/sign\/satuan-item-photos\//, { timeout: 20000 });
    await ctx.close();
  });
  await step('CS dashboard: bag summary (no categories) and photo button', async () => {
    const { ctx, page } = await staffPage('cs');
    await page.goto(`${APP}/cs/dashboard`, { waitUntil: 'networkidle' });
    const card = page.locator('div.rounded-2xl', { hasText: String(instant?.order_number) }).last();
    await card.getByText('Kantong 2 — Cuci Setrika', { exact: false }).waitFor({ timeout: 25000 });
    assert.equal(await card.getByText('CD (celana dalam)', { exact: false }).count(), 0);
    const [popup] = await Promise.all([ctx.waitForEvent('page'), card.getByRole('button', { name: 'Lihat Foto' }).click()]);
    await popup.waitForURL(/\/storage\/v1\/object\/sign\/satuan-item-photos\//, { timeout: 20000 });
    await ctx.close();
  });
  await step('Driver dashboard lists the instant order for the on-duty outlet driver', async () => {
    const { ctx, page } = await staffPage('driverA');
    await page.goto(`${APP}/driver/dashboard`, { waitUntil: 'networkidle' });
    await page.getByText('[STAGING] Pelanggan Uji', { exact: false }).first().waitFor({ timeout: 25000 });
    await ctx.close();
  });

  // --- 6. report-error --------------------------------------------------------
  await step('report-error: stored row carries no payload / personal data', async () => {
    const r = await fetch(APP + '/api/customer/order/report-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP },
      body: JSON.stringify({
        stage: 'pickup_order_create', category: 'not_null', column: 'pickup_date',
        message: `Failing row contains ([STAGING] Pelanggan Uji, ${SYN.customer}, jl uji). null value in column "pickup_date"`,
        payload: { customer_phone: SYN.customer }, context: { isFuturePickup: false, kiloanLines: 2, satuanLines: 1 }
      })
    });
    assert.equal(r.status, 200);
    const { data } = await service.from('error_logs').select('*').eq('source', 'customer_order_form').gte('created_at', runStart).order('created_at', { ascending: false }).limit(1);
    const row = JSON.stringify(data?.[0] || {});
    if (!data?.[0]) {
      // insertErrorLog ignores insert errors: replay its exact row shape with the service role.
      const probe = await probeInsert(service, 'error_logs', {
        source: 'customer_order_form', code: 'pickup_order_create:not_null', message: '[STAGING] probe', hint: '[STAGING] probe',
        severity: 'ERROR', context: { column: 'pickup_date' }, transaction_id: null
      });
      assert.fail(`no error_logs row; same row via service role: ${probe}`);
    }
    for (const leaked of [SYN.customer, 'jl uji', 'Pelanggan Uji']) assert.ok(!row.includes(leaked), `leaked ${leaked}`);
  });

  // --- 7. deposit: POS credit ------------------------------------------------
  const runId = Date.now().toString(36);
  const NEW_PHONE = '080000000099';
  await step('Removed Xendit routes answer 404', async () => {
    for (const path of ['/api/qris/webhook', '/qris/webhook', '/api/qris/charge']) {
      const r = await fetch(APP + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'PAID', event: 'qr.payment' }) });
      assert.equal(r.status, 404, path);
    }
  });
  await step('POS deposit credit for a new number: registered_by = kasir, repeated request credits once', async () => {
    const call = () =>
      fetch(APP + '/api/deposit/mutate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${PAYMENT_OPS_SECRET}` },
        body: JSON.stringify({ action: 'credit', phone: NEW_PHONE, amount: 50000, paymentId: `stg-pos-${runId}`, staffId: staffId.kasirA })
      });
    const a = await call();
    assert.equal(a.status, 200, await a.text());
    const b = await call();
    assert.equal(b.status, 200, await b.text());
    const { data, error } = await service.from('customers').select('registered_by, deposit_balance').eq('phone', NEW_PHONE).maybeSingle();
    assert.ifError(error);
    assert.deepEqual({ registered_by: data?.registered_by, deposit_balance: Number(data?.deposit_balance) }, { registered_by: '[STAGING] Kasir A', deposit_balance: 50000 });
  });

  await step('No browser request reached the production database host', async () => {
    assert.deepEqual(prodHits, []);
  });

  await browser.close();
  if (uploaded.length) await service.storage.from(BUCKET).remove(uploaded);
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed${selftest ? ' (LOCAL SELFTEST — not a staging result)' : ` against staging ${s.ref}`}`);
  stop(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`ABORT | ${(e as Error).message.split('\n')[0]}`);
  process.exit(1);
});
