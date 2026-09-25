// Build against a NON-production mock project (preview/dev builds refuse the
// production database, see lib/supabaseTarget.ts), then run:
//   NEXT_PUBLIC_SUPABASE_URL=https://e2emockproject.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock npm run build
//   npm i --no-save playwright-core && CHROMIUM_PATH=/path/to/chrome node scripts/e2e/customer-order.e2e.mjs
// UI E2E (mobile viewport) of the customer dashboard: Bandung outlet, 3-step
// order form, state kept across steps, single order on double tap, the
// Rp15.000 → Rp1.000 detail, the "Jemput sekarang" pickup_date fix (the mock
// DB enforces the real NOT NULL constraint so a regression fails loudly),
// the bag-category kiloan redesign (combined + split), the 3kg minimum, and
// the mandatory satuan item photo. ALL Supabase/Storage traffic is
// intercepted — no production access.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const OUT = process.env.E2E_SHOTS_DIR || `${tmpdir()}/lm-customer-e2e`;
mkdirSync(OUT, { recursive: true });
const APP = 'http://localhost:3300';
const app = spawn('npx', ['next', 'start', '-p', '3300'], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { await fetch(APP + '/api/customer/auth/session'); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}

const DAGO = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Laundry Hari ini - Tubagus', city: '-',
  address_detail: 'Jl. Tubagus Ismail Raya No. 12, Dago, Coblong, Kota Bandung, Jawa Barat 40134',
  latitude: -6.8853, longitude: 107.6195, is_coming_soon: false, is_overcapacity: false
};
const SEMARANG = { id: '22222222-2222-4222-8222-222222222222', name: 'Outlet Semarang', city: 'Semarang', latitude: -6.99, longitude: 110.42, is_coming_soon: false };
const TX = {
  id: '33333333-3333-4333-8333-333333333333', receipt_number: 'TRX-152618', customer_phone: '085172141494', outlet_id: DAGO.id,
  status: 'Sudah Dibayar', is_paid: true, payment_status: 'paid', amount: 1000, discount_type: 'nominal', discount_value: 14000,
  discount_amount: 14000, delivery_fee: 0, duration: 'Reguler (3 Hari)', created_at: '2026-09-12T09:50:00Z', service_type: 'Cuci Kering Lipat',
  items: [{ name: 'Cuci Kering Lipat', type: 'kg', qty: 3, weight: 3, price: 5000 }]
};
const baseTables = () => ({
  outlets: [DAGO, SEMARANG],
  transactions: [TX],
  pickup_orders: [],
  app_settings: [{ id: 1, dynamic_services: JSON.stringify([
    { id: 's1', name: 'Cuci Kering Lipat', type: 'kg', price: 5000 },
    { id: 's3', name: 'Cuci Setrika', type: 'kg', price: 6000 },
    { id: 's2', name: 'Bedcover Single', type: 'pcs', price: 25000 }
  ]), outlet_overrides: '{}', receipt_terms: 'S&K uji coba', promos_data: '[]' }],
  customers: [{ phone: '085172141494', name: 'Asep Rahmat', deposit_balance: 0 }],
  customer_addresses: [
    { id: 'a1', customer_phone: '085172141494', label_name: 'Lainnya', full_address: 'Hotel sheraton bandung', is_primary: false, latitude: -6.87, longitude: 107.61 },
    { id: 'a2', customer_phone: '085172141494', label_name: 'Rumah', full_address: 'jl ir juanda dago no.378 bandung', is_primary: true, latitude: -6.886, longitude: 107.613 },
    { id: 'a3', customer_phone: '085172141494', label_name: 'Rumah', full_address: 'Jl supriyadi semarang', is_primary: false, latitude: -6.99, longitude: 110.45 }
  ]
});

const results = [];
const productionDbHits = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

/**
 * One isolated mock backend + browser context per scenario, so scenarios
 * never share pickup_orders/inserts state with each other.
 */
async function newScenario(opts = {}) {
  const tables = baseTables();
  const inserts = [];
  const outbound = [];
  let uploadShouldFail = Boolean(opts.uploadShouldFail);
  let insertFailMessage = opts.insertFailMessage || '';
  const photoConfig = opts.photoConfig || { enabled: true, canUpload: true };
  const reports = [];
  const uploadUrlRequests = [];

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: { latitude: -6.886, longitude: 107.613 }, permissions: ['geolocation'], locale: 'id-ID'
  });
  await ctx.addInitScript(() => localStorage.setItem('laundry_customer_phone', '085172141494'));
  const dialogs = [];
  let acceptDialogs = true;
  ctx.on('page', (p) =>
    p.on('dialog', (d) => {
      dialogs.push(d.message());
      return acceptDialogs ? d.accept() : d.dismiss();
    })
  );

  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname.startsWith('/api/road-distance')) return route.fulfill({ json: { km: 2.5 } });
      // Server-side photo routes need a verified session + service role; the
      // real routes are covered by scripts/e2e/local-supabase. Here they are
      // stubbed so the UI rules can be exercised per scenario.
      if (url.pathname === '/api/customer/satuan-photo/config') return route.fulfill({ json: photoConfig });
      if (url.pathname === '/api/customer/satuan-photo/upload-url') {
        uploadUrlRequests.push(req.postData());
        const n = String(uploadUrlRequests.length).padStart(12, '0');
        return route.fulfill({ json: { path: `${'a'.repeat(32)}/2026-09/123e4567-e89b-42d3-a456-${n}.jpg`, token: 'signed-upload-token' } });
      }
      // The order itself is created by the server (/api/customer/order/create,
      // service role; validation covered by lib/customerOrderServer.test.ts and
      // the staging E2E). Stubbed here with the same observable contract:
      // idempotent per order_number, 2 tasks for instant orders, a 500 with the
      // row data stripped when the insert fails.
      if (url.pathname === '/api/customer/order/create') {
        const body = req.postDataJSON();
        if (insertFailMessage) {
          const detail = insertFailMessage.replace(/Failing row contains \([\s\S]*\)\.?/gi, '');
          return route.fulfill({ status: 500, json: { error: 'Pesanan belum tersimpan. Coba lagi sebentar lagi.', detail } });
        }
        if (body.pickup_date == null) {
          return route.fulfill({ status: 500, json: { error: 'x', detail: 'null value in column "pickup_date" of relation "pickup_orders" violates not-null constraint' } });
        }
        const prior = tables.pickup_orders.find((r) => r.order_number === body.order_number);
        if (prior) return route.fulfill({ json: { id: prior.id, order_number: prior.order_number, duplicate: true } });
        const row = { id: `new-${inserts.length}-0`, ...body };
        inserts.push({ table: 'pickup_orders', rows: [row] });
        tables.pickup_orders.push(row);
        if (!body.pickup_time) {
          inserts.push({ table: 'system_tasks', rows: ['driver', 'cs'].map((role) => ({ assigned_to_role: role, source_id: row.id })) });
        }
        return route.fulfill({ json: { id: row.id, order_number: row.order_number, status: row.status } });
      }
      // Saved addresses are served by the server (/api/customer/addresses,
      // covered by scripts/e2e/pickup-location.e2e.mjs); stubbed from the mock table.
      if (url.pathname === '/api/customer/addresses') {
        const listOut = () => {
          const rows = tables.customer_addresses || [];
          const primary = rows.find((r) => r.is_primary)?.id || rows[0]?.id;
          return { addresses: rows.map((r) => ({ id: r.id, label: r.label_name || 'Alamat', full_address: r.full_address, is_primary: r.id === primary, latitude: r.latitude ?? null, longitude: r.longitude ?? null })) };
        };
        if (req.method() === 'GET') return route.fulfill({ json: listOut() });
        const body = req.postDataJSON() || {};
        tables.customer_addresses = tables.customer_addresses || [];
        if (body.action === 'save') {
          const a = body.address || {};
          const own = tables.customer_addresses.find((r) => r.id === a.id);
          const fields = { label_name: a.label, full_address: a.full_address, latitude: a.latitude ?? null, longitude: a.longitude ?? null };
          if (own) Object.assign(own, fields);
          else tables.customer_addresses.push({ id: `addr-${tables.customer_addresses.length + 1}`, customer_phone: '085172141494', is_primary: false, ...fields });
        }
        return route.fulfill({ json: listOut() });
      }
      if (url.pathname === '/api/customer/order/report-error') {
        reports.push(req.postData() || '');
        return route.fulfill({ json: { ok: true } });
      }
      return route.continue();
    }
    outbound.push(url.hostname);
    if (url.hostname.startsWith('qlgbjvzabnfqmfnjdkmo.')) {
      outbound.push('UNEXPECTED production database request');
      productionDbHits.push(`${req.method()} ${url.pathname}`);
      return route.abort();
    }
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ status: 204, body: '' });

    // Storage upload (satuan item photos) — mocked success/failure, never a
    // real network call, and never returns a public URL (matches the
    // private-bucket design: only a storage path is returned).
    const storageMatch = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/([a-z-]+)\/(.+)$/);
    if (url.pathname.startsWith('/storage/v1/') && !storageMatch) {
      // Anything else against Storage (direct upload, list, sign) must not happen from the browser.
      outbound.push(`UNEXPECTED ${req.method()} ${url.pathname}`);
      return route.fulfill({ status: 403, json: { message: 'blocked by test' } });
    }
    if (storageMatch && req.method() === 'PUT') {
      assert.equal(url.searchParams.get('token'), 'signed-upload-token');
      if (uploadShouldFail) {
        return route.fulfill({ status: 400, json: { message: 'Bucket not found', statusCode: '404' } });
      }
      return route.fulfill({ status: 200, json: { Id: 'mock-id', Key: `${storageMatch[1]}/${storageMatch[2]}` } });
    }

    const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)/);
    if (!m) return route.fulfill({ status: 200, json: [] });
    const table = m[1];
    const method = req.method();
    if (method === 'POST') {
      const body = req.postDataJSON();
      const rows = Array.isArray(body) ? body : [body];
      // Reproduce the REAL Postgres constraint that caused the original bug
      // report ("null value in column pickup_date ... violates not-null
      // constraint"). If this regresses, the scenario fails with the exact
      // error the customer saw, not just a shallow field check.
      if (table === 'pickup_orders' && insertFailMessage) {
        return route.fulfill({ status: 400, json: { message: insertFailMessage, code: '23514' } });
      }
      if (table === 'pickup_orders' && rows.some((r) => r.pickup_date == null)) {
        return route.fulfill({
          status: 400,
          json: { message: 'null value in column "pickup_date" of relation "pickup_orders" violates not-null constraint', code: '23502' }
        });
      }
      const withIds = rows.map((r, i) => ({ id: `new-${inserts.length}-${i}`, ...r }));
      inserts.push({ table, rows: withIds });
      if (table === 'pickup_orders') tables.pickup_orders.push(...withIds);
      if (table === 'error_logs') tables.error_logs = [...(tables.error_logs || []), ...withIds];
      return route.fulfill({ status: 201, json: withIds });
    }
    if (method === 'PATCH') return route.fulfill({ status: 200, json: [] });
    let rows = tables[table] || [];
    if (table === 'pickup_orders' && url.searchParams.get('order_number')) {
      const want = url.searchParams.get('order_number').replace(/^eq\./, '');
      rows = rows.filter((r) => r.order_number === want);
    }
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${rows.length}` }, body: '' });
    const accept = req.headers()['accept'] || '';
    if (accept.includes('vnd.pgrst.object')) {
      return rows.length ? route.fulfill({ json: rows[0] }) : route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } });
    }
    return route.fulfill({ json: rows, headers: { 'content-range': `0-${rows.length}/${rows.length}` } });
  });

  const page = await ctx.newPage();
  return {
    ctx, page, tables, inserts, outbound, reports, uploadUrlRequests,
    dialogs,
    setInsertFailMessage: (v) => { insertFailMessage = v; },
    setAcceptDialogs: (v) => { acceptDialogs = v; },
    setUploadShouldFail: (v) => { uploadShouldFail = v; },
    close: () => ctx.close()
  };
}

// Fills the 5 mandatory category inputs of ONE kiloan bag (bagIdx 0-based).
const fillKiloanBag = async (page, bagIdx, counts) => {
  for (const [labelPart, value] of Object.entries(counts)) {
    await page.getByLabel(`${labelPart} Kantong ${bagIdx + 1}`).fill(String(value));
  }
};
const CATEGORY_LABELS = {
  bajuRingan: 'Baju ringan (kaos/kemeja)',
  celanaBiasa: 'Celana biasa',
  celanaJeans: 'Celana jeans',
  cd: 'CD (celana dalam)',
  bra: 'Bra'
};
const asLabeled = (counts) => Object.fromEntries(Object.entries(counts).map(([k, v]) => [CATEGORY_LABELS[k], v]));
const kiloanServiceSelect = (page) => page.locator('label:has-text("Pilih Jenis Kiloan") + select');
const kiloanDurationSelect = (page) => page.locator('label:has-text("Durasi Kiloan") + select');
// Nothing is preselected in the kiloan form: the customer picks every choice.
// Pass null to leave a choice as it is (e.g. luntur is asked once per order).
const chooseKiloan = async (
  page,
  { bags = 1, wash = 'Dicampur', fading = 'Tidak', service = 'Cuci Kering Lipat', duration = 'Reguler 3 Hari' } = {}
) => {
  const plus = page.locator('button[aria-label="Tambah"]').first(); // "Jumlah Kantong" stepper (first on the page)
  for (let i = 0; i < bags; i++) await plus.click();
  if (wash) await page.getByRole('button', { name: wash, exact: true }).click();
  if (fading) await page.getByRole('button', { name: fading, exact: true }).first().click();
  if (service) await kiloanServiceSelect(page).selectOption({ label: service });
  if (duration) await kiloanDurationSelect(page).selectOption({ label: duration });
};
// Satuan item + its duration also start empty.
const chooseSatuan = async (page, { item = 'Bedcover Single', duration = 'Reguler 3 Hari' } = {}) => {
  await page.locator('label:has-text("Pilih Item Satuan") + select').selectOption({ label: item });
  await page.locator('label:has-text("Durasi Item Ini") + select').selectOption({ label: duration });
};

// A visible, tiny PNG file for upload — a real image/png so client-side
// compression (canvas decode) succeeds instead of falling through.
const TEST_PHOTO = {
  name: 'item.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
};

// ---------------------------------------------------------------------------
// Scenario 1: full happy-path order — Bandung outlet, Rp15k→Rp1k detail,
// 3-step form, combined-mode kiloan reaching the 3kg minimum PLUS a satuan
// item with its mandatory photo, single order on a triple-tap submit, and
// the "Jemput sekarang" pickup_date fix (mock DB enforces the real
// constraint).
// ---------------------------------------------------------------------------
{
  const s = await newScenario();
  const { page } = s;
  await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });

  await step('Beranda: Bandung shows the Dago branch (no "Belum ada cabang resmi")', async () => {
    await page.getByText('Outlet Terdekat').waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByText('Belum ada cabang resmi').count(), 0);
    await page.getByText('Laundry Hari ini - Tubagus').first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: `${OUT}/01-beranda.png`, fullPage: true });
  });
  await step('Beranda: term explanations available', async () => {
    await page.getByText('Arti Pesan Express, poin & deposit').click();
    await page.getByText('1 poin = Rp1', { exact: false }).waitFor();
    await page.screenshot({ path: `${OUT}/02-istilah.png`, fullPage: true });
  });

  await step('Aktivitas: progress separate from payment, Rp1.000 total with savings', async () => {
    await page.locator('nav').getByRole('button', { name: 'Aktivitas' }).click();
    await page.getByText('TRX-152618').first().waitFor();
    await page.getByText('Sedang disortir').first().waitFor();
    await page.getByText('Lunas').first().waitFor();
    await page.getByText('Hemat Rp 14.000').first().waitFor();
    await page.getByText('Laundry Hari ini - Tubagus', { exact: false }).first().waitFor();
    await page.screenshot({ path: `${OUT}/03-aktivitas.png`, fullPage: true });
  });
  await step('Detail: subtotal Rp15.000, diskon Rp14.000, total Rp1.000', async () => {
    await page.getByText('Detail item & status').first().click();
    const modal = page.locator('text=Rincian Item & Harga').locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');
    await modal.getByText('Subtotal layanan').waitFor();
    const txt = await modal.innerText();
    assert.match(txt, /Subtotal layanan\s*Rp 15\.000/);
    assert.match(txt, /Diskon\s*- Rp 14\.000/);
    assert.match(txt, /Total bayar\s*Rp 1\.000/);
    await page.screenshot({ path: `${OUT}/04-detail.png`, fullPage: false });
    await page.getByRole('button', { name: 'Kembali' }).last().click();
  });

  await step('Order step 1: validation blocks empty address', async () => {
    await page.locator('nav').getByRole('button', { name: 'Order' }).click();
    await page.getByRole('tab', { name: /Alamat & Jemput/ }).waitFor();
    await page.getByRole('button', { name: '+ Alamat baru' }).click();
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('alert').filter({ hasText: 'Cari dan pilih nama jalan' }).waitFor();
  });
  await step('Order step 1: duplicate "Rumah" labels distinguishable; pick address, outlet & courier', async () => {
    await page.getByRole('button', { name: /Rumah · Jl Ir Juanda Dago/ }).waitFor();
    await page.getByRole('button', { name: /Rumah · Jl Supriyadi Semarang/ }).waitFor();
    await page.getByRole('button', { name: /Rumah · Jl Ir Juanda Dago/ }).click();
    await page.getByLabel('Pilih outlet').waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: 'Cari dan pilih nama jalan' }).count(), 0, 'stale error cleared');
    assert.equal(await page.getByLabel('Pilih outlet').inputValue(), DAGO.id);
    await page.getByText('Metode penjemputan', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Instan \(Gojek/ }).click();
    await page.getByText(/Estimasi ongkir antar-jemput Rp 18\.000/).waitFor();
    await page.getByPlaceholder('Catatan penjemputan').fill('Titip satpam');
    await page.screenshot({ path: `${OUT}/05-step1.png`, fullPage: true });
  });
  await step('Sticky action bar is above bottom navigation (not covered)', async () => {
    const bar = await page.getByRole('button', { name: /Lanjut/ }).boundingBox();
    const nav = await page.locator('nav').last().boundingBox();
    assert.ok(bar.y + bar.height <= nav.y + 1, `bar bottom ${bar.y + bar.height} vs nav top ${nav.y}`);
  });

  await step('Order step 2: "Informasi Detail Cucian Kiloan" is above the service dropdown', async () => {
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
    await page.getByText('Paket Laundry Kiloan').click();
    const infoY = (await page.getByText('Informasi Detail Cucian Kiloan').boundingBox()).y;
    const selectY = (await page.locator('label', { hasText: 'Pilih Jenis Kiloan' }).boundingBox()).y;
    assert.ok(infoY < selectY, `info block (${infoY}) should be above the service select (${selectY})`);
  });
  await step('Order step 2: kiloan requires "Tambah Paket Kiloan Ini" — checking the box alone is not enough', async () => {
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('alert').filter({ hasText: 'Tambah Paket Kiloan Ini' }).waitFor();
  });
  await step('Order step 2: nothing is preselected — every kiloan choice is asked for, no "Express" badge', async () => {
    assert.equal(await page.locator('[aria-label="Jumlah kantong"]').innerText(), '–');
    assert.equal(await kiloanServiceSelect(page).inputValue(), '');
    assert.equal(await kiloanDurationSelect(page).inputValue(), '');
    for (const name of ['Dicampur', 'Dipisah', 'Tidak', 'Ya']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).first().getAttribute('aria-pressed'), 'false', name);
    }
    const add = page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' });
    const expectAlert = async (text) => {
      await add.click();
      await page.getByRole('alert').filter({ hasText: text }).waitFor();
    };
    await expectAlert('jumlah kantong');
    await page.locator('button[aria-label="Tambah"]').first().click();
    assert.equal(await page.locator('[aria-label="Jumlah kantong"]').innerText(), '1');
    await expectAlert('proses cuci');
    await page.getByRole('button', { name: 'Dicampur', exact: true }).click();
    await expectAlert('pakaian luntur');
    await page.getByRole('button', { name: 'Tidak', exact: true }).first().click();
    await expectAlert('Pilih jenis kiloan');
    await kiloanServiceSelect(page).selectOption({ label: 'Cuci Kering Lipat' });
    await expectAlert('durasi kiloan');
    await kiloanDurationSelect(page).selectOption({ label: 'Oneday 24jam' });
    assert.equal(await page.getByText('Express', { exact: true }).count(), 0, 'no Express badge next to the duration');
  });
  await step('Order step 2: all 5 category inputs are required (0 allowed, empty is not)', async () => {
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'Lengkapi semua isian' }).waitFor();
  });
  await step('Order step 2: all-zero categories rejected (total must be > 0)', async () => {
    await fillKiloanBag(page, 0, asLabeled({ bajuRingan: 0, celanaBiasa: 0, celanaJeans: 0, cd: 0, bra: 0 }));
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'harus lebih dari 0' }).waitFor();
  });
  await step('Order step 2: pcs/kg computed automatically, added to cart — but under the 3kg minimum', async () => {
    // 2 × baju ringan (200g) + 1 × celana biasa (500g) = 900g = 0.9kg, 3 pcs.
    await fillKiloanBag(page, 0, asLabeled({ bajuRingan: 2, celanaBiasa: 1, celanaJeans: 0, cd: 0, bra: 0 }));
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    await page.getByText('~0.9 Kg', { exact: false }).first().waitFor();
    await page.getByText('3 Pcs (estimasi)', { exact: false }).first().waitFor();
    await page.getByText('Kasir akan menimbang ulang', { exact: false }).waitFor();
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('alert').filter({ hasText: 'Total kiloan minimal 3 kg' }).waitFor();
  });
  await step('Order step 2: adding more kiloan reaches the 3kg minimum and clears the error', async () => {
    // Add a 2nd combined package: 12 × baju ringan (200g) = 2.4kg → total 3.3kg.
    // Jumlah kantong & proses cuci are chosen again for every package.
    assert.equal(await page.locator('[aria-label="Jumlah kantong"]').innerText(), '–');
    await chooseKiloan(page, { fading: null, service: null, duration: null });
    await fillKiloanBag(page, 0, asLabeled({ bajuRingan: 12, celanaBiasa: 0, celanaJeans: 0, cd: 0, bra: 0 }));
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    assert.equal(await page.getByRole('alert').filter({ hasText: 'Total kiloan' }).count(), 0);
  });

  await step('Order step 2: satuan item is blocked without a photo', async () => {
    await page.getByText('Items Satuan', { exact: false }).click();
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'Pilih item satuan' }).waitFor();
    await chooseSatuan(page);
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'wajib' }).waitFor();
  });
  await step('Order step 2: photo upload failure shows an error, does not silently succeed', async () => {
    s.setUploadShouldFail(true);
    await page.getByLabel('Unggah foto item satuan').setInputFiles(TEST_PHOTO);
    await page.getByText('Gagal mengunggah foto', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'gagal diunggah' }).waitFor();
  });
  await step('Order step 2: successful photo upload unlocks adding the satuan item', async () => {
    s.setUploadShouldFail(false);
    await page.getByLabel('Unggah foto item satuan').setInputFiles(TEST_PHOTO);
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'gagal diunggah' }).count(), 0);
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'wajib' }).count().then((n) => assert.equal(n, 0));
  });
  await step('Order step 2: continue to review', async () => {
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
  });

  await step('Selections persist when going back and forth', async () => {
    await page.getByRole('tab', { name: /Alamat & Jemput/ }).click();
    await page.getByPlaceholder('Catatan penjemputan').waitFor();
    assert.equal(await page.getByPlaceholder('Catatan penjemputan').inputValue(), 'Titip satpam');
    assert.equal(await page.getByLabel('Pilih outlet').inputValue(), DAGO.id);
    await page.getByRole('tab', { name: /Layanan/ }).click();
    await page.getByText('Paket Laundry Kiloan').waitFor();
    assert.equal(await page.locator('form input[type=checkbox]').first().isChecked(), true);
    await page.getByRole('tab', { name: /Periksa & Pesan/ }).click();
    const summary = await page.locator('form').innerText();
    assert.match(summary, /Laundry Hari ini - Tubagus/);
    assert.match(summary, /Instan \(Gojek/);
    assert.match(summary, /Catatan: Titip satpam/);
    await page.screenshot({ path: `${OUT}/06-step3.png`, fullPage: true });
  });
  await step('Step 3: agreements reachable above the sticky bar', async () => {
    const cb = page.locator('form input[type=checkbox]').last();
    await cb.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    const box = await cb.boundingBox();
    const bar = await page.getByRole('button', { name: /Pesan Sekarang/ }).boundingBox();
    assert.ok(box.y + box.height < bar.y - 8, `checkbox ${box.y} vs bar ${bar.y}`);
    await page.screenshot({ path: `${OUT}/06b-step3-bottom.png` });
  });
  await step('Step 3 validation: agreements required', async () => {
    await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
    await page.getByRole('alert').filter({ hasText: 'barang berharga' }).waitFor();
  });
  await step('Double tap "Pesan Sekarang" creates exactly ONE pickup order — with a valid pickup_date (the original bug)', async () => {
    const checks = page.locator('form input[type=checkbox]');
    const n = await checks.count();
    for (let i = 0; i < n; i++) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[type=submit]')].find((b) => /Pesan Sekarang/.test(b.textContent || ''));
      btn.click();
      btn.click();
      btn.click();
    });
    await page.waitForTimeout(2500);
    // If the pickup_date regression came back, the mock DB above returns the
    // exact Postgres not-null error and this insert never lands — surfacing
    // as a friendly toast instead of a crash (checked next), and zero rows here.
    const orders = s.inserts.filter((i) => i.table === 'pickup_orders');
    assert.equal(orders.length, 1, `pickup_orders inserts: ${orders.length}`);
    const o = orders[0].rows[0];
    assert.ok(o.pickup_date, 'pickup_date must be set for "Jemput sekarang" (the original bug)');
    assert.match(o.pickup_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(o.pickup_time, null, 'instant orders keep pickup_time null so they are not misclassified as "Terjadwal"');
    assert.equal(o.status, 'Menunggu Kurir');
    assert.equal(o.outlet_id, DAGO.id);
    assert.equal(o.customer_phone, '085172141494');
    assert.equal(o.courier_type, 'THIRD_PARTY');
    assert.equal(o.delivery_fee, 18000);
    assert.ok(o.latitude && o.longitude);
    assert.match(o.address, /jl ir juanda dago/);
    assert.match(o.notes, /Catatan: Titip satpam/);
    assert.match(o.notes, /\[S&K\] Disetujui/);
    // Two combined kiloan packages (0.9kg + 2.4kg) + total kg ≥ 3.
    const kiloanItems = o.items.filter((it) => it.type === 'kg');
    assert.equal(kiloanItems.length, 2);
    const totalKg = kiloanItems.reduce((s2, it) => s2 + Number(it.weight || 0), 0);
    assert.ok(totalKg >= 3, `total kiloan kg ${totalKg} should be >= 3`);
    assert.deepEqual(kiloanItems[0].bag_category_counts, { bajuRingan: '2', celanaBiasa: '1', celanaJeans: '0', cd: '0', bra: '0' });
    assert.equal(kiloanItems[0].duration, 'Oneday', 'the duration the customer picked, no default');
    assert.equal(o.bag_count, 2, 'two packages of 1 kantong each');
    assert.equal(o.has_fading, false, 'luntur answered "Tidak"');
    // Satuan item carries the uploaded photo's storage PATH (not a public URL).
    const satuanItems = o.items.filter((it) => it.type === 'pcs');
    assert.equal(satuanItems.length, 1);
    assert.equal(satuanItems[0].pieces.length, 1);
    assert.ok(satuanItems[0].pieces[0].photo_path, 'satuan piece must carry a photo_path');
    assert.ok(!String(satuanItems[0].pieces[0].photo_path).startsWith('http'), 'stored as a path, not a public URL');
    assert.match(satuanItems[0].pieces[0].photo_path, /^a{32}\/2026-09\/[0-9a-f-]{36}\.jpg$/, 'server-issued path');
    assert.deepEqual(s.outbound.filter((x) => x.startsWith('UNEXPECTED')), [], 'browser never touches the bucket directly');
    const tasks = s.inserts.filter((i) => i.table === 'system_tasks').flatMap((i) => i.rows);
    assert.deepEqual(tasks.map((t) => t.assigned_to_role).sort(), ['cs', 'driver'], 'driver + cs tasks created');
    await page.screenshot({ path: `${OUT}/07-after-order.png`, fullPage: true });
  });

  await s.close();
}

// ---------------------------------------------------------------------------
// Scenario 2: split kiloan bags ("Pisah Perkantong") — 2 kantong, each its
// own service/duration/category counts, submitted as 2 separate lines.
// ---------------------------------------------------------------------------
{
  const s = await newScenario();
  const { page } = s;
  await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('nav').getByRole('button', { name: 'Order' }).click();
  await page.getByRole('button', { name: /Rumah · Jl Ir Juanda Dago/ }).click();
  await page.getByLabel('Pilih outlet').waitFor();
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
  await page.getByText('Paket Laundry Kiloan').click();

  await step('Split bags: increasing Jumlah Kantong to 2 and choosing "Dipisah" renders Kantong 1 & 2', async () => {
    await page.getByRole('button', { name: 'Tambah', exact: false }).count(); // no-op sanity
    const plus = page.locator('button[aria-label="Tambah"]');
    await plus.first().click(); // bagCount – -> 1
    await plus.first().click(); // bagCount 1 -> 2
    await page.getByRole('button', { name: 'Dipisah' }).click();
    await page.getByRole('button', { name: 'Tidak', exact: true }).first().click(); // luntur
    await page.getByText('Kantong 1', { exact: true }).waitFor();
    await page.getByText('Kantong 2', { exact: true }).waitFor();
  });
  await step('Split bags: dropping a filled kantong asks first; cancel keeps its data', async () => {
    await page.getByLabel('Bra Kantong 2').fill('4');
    s.setAcceptDialogs(false);
    await page.getByRole('button', { name: 'Dicampur' }).click();
    await page.waitForTimeout(200);
    assert.match(s.dialogs.at(-1) || '', /Kantong 2.*akan dihapus/);
    await page.getByText('Kantong 2', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Bra Kantong 2').inputValue(), '4');
    s.setAcceptDialogs(true);
  });
  await step('Split bags: choosing "Dicampur" with 2 kantong does NOT create two packages', async () => {
    await page.getByRole('button', { name: 'Dicampur' }).click();
    assert.equal(await page.getByText('Kantong 1', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Dipisah' }).click();
    await page.getByText('Kantong 1', { exact: true }).waitFor();
  });
  await step('Split bags: each kantong has independent service/duration/category inputs', async () => {
    const kantong1 = page.getByText('Kantong 1', { exact: true }).locator('xpath=..');
    const kantong2 = page.getByText('Kantong 2', { exact: true }).locator('xpath=..');
    await kantong1.getByRole('combobox').first().selectOption({ label: 'Cuci Kering Lipat' });
    await kantong2.getByRole('combobox').first().selectOption({ label: 'Cuci Setrika' });
    // Durations start empty per kantong too.
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'Pilih durasi untuk Kantong 1' }).waitFor();
    await kantong1.getByRole('combobox').nth(1).selectOption({ label: 'Reguler 3 Hari' });
    await kantong2.getByRole('combobox').nth(1).selectOption({ label: 'Quick 3 Jam' });
    await fillKiloanBag(page, 0, asLabeled({ bajuRingan: 10, celanaBiasa: 0, celanaJeans: 0, cd: 0, bra: 0 })); // 2kg
    await fillKiloanBag(page, 1, asLabeled({ bajuRingan: 0, celanaBiasa: 2, celanaJeans: 0, cd: 0, bra: 0 })); // 1kg
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
  });
  await step('Split bags: both kantong were added as separate cart lines in ONE click', async () => {
    await page.getByText('Cuci Kering Lipat · ~2 Kg', { exact: false }).waitFor();
    await page.getByText('Cuci Setrika · ~1 Kg', { exact: false }).waitFor();
    // Form resets to a single combined bag ready for the next addition.
    assert.equal(await page.getByText('Kantong 1', { exact: true }).count(), 0);
    assert.equal(await page.locator('[aria-label="Jumlah kantong"]').innerText(), '–');
  });

  await step('Split bags: fill required agreements/name and submit — payload carries 2 distinct kiloan lines with per-bag detail', async () => {
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
    await page.getByPlaceholder('Nama Anda').fill('Asep Rahmat');
    const checks = page.locator('form input[type=checkbox]');
    const n = await checks.count();
    for (let i = 0; i < n; i++) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
    await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
    await page.waitForTimeout(2000);
    const orders = s.inserts.filter((i) => i.table === 'pickup_orders');
    assert.equal(orders.length, 1);
    const o = orders[0].rows[0];
    assert.ok(o.pickup_date);
    const kiloanItems = o.items.filter((it) => it.type === 'kg');
    assert.equal(kiloanItems.length, 2, 'two separate bags -> two separate kiloan lines');
    assert.equal(kiloanItems[0].name, 'Cuci Kering Lipat');
    assert.equal(kiloanItems[1].name, 'Cuci Setrika');
    assert.equal(kiloanItems[0].duration, 'Reguler (3 Hari)');
    assert.equal(kiloanItems[1].duration, 'Quick');
    assert.equal(kiloanItems[0].weight, 2);
    assert.equal(kiloanItems[1].weight, 1);
    assert.deepEqual(kiloanItems[0].bag_category_counts, { bajuRingan: '10', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' });
    assert.deepEqual(kiloanItems[1].bag_category_counts, { bajuRingan: '0', celanaBiasa: '2', celanaJeans: '0', cd: '0', bra: '0' });
    // bag_count on the order reflects the ACTUAL number of separate packages.
    assert.equal(o.bag_count, 2);
    assert.equal(o.wash_process, 'Pisah Perkantong');
  });

  await s.close();
}

// ---------------------------------------------------------------------------
// Scenario 3: "Jadwalkan" (scheduled pickup) also gets a valid pickup_date —
// the fix must not be specific to the instant-pickup code path.
// ---------------------------------------------------------------------------
{
  const s = await newScenario();
  const { page } = s;
  await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('nav').getByRole('button', { name: 'Order' }).click();
  await page.getByRole('button', { name: /Rumah · Jl Ir Juanda Dago/ }).click();
  await page.getByLabel('Pilih outlet').waitFor();

  await step('Jadwalkan: choosing a future date/time and submitting sets pickup_date + status Terjadwal', async () => {
    await page.getByRole('button', { name: /Jadwalkan/ }).click();
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
    await page.getByText('Paket Laundry Kiloan').click();
    await chooseKiloan(page, { bags: 2, wash: 'Dicampur' }); // 2 kantong, one wash
    await fillKiloanBag(page, 0, asLabeled({ bajuRingan: 15, celanaBiasa: 0, celanaJeans: 0, cd: 0, bra: 0 })); // 3kg
    await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
    await page.getByPlaceholder('Nama Anda').fill('Asep Rahmat');
    const checks = page.locator('form input[type=checkbox]');
    const n = await checks.count();
    for (let i = 0; i < n; i++) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
    await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
    await page.waitForTimeout(2000);
    const orders = s.inserts.filter((i) => i.table === 'pickup_orders');
    assert.equal(orders.length, 1);
    const o = orders[0].rows[0];
    assert.ok(o.pickup_date, 'scheduled orders must also have a valid pickup_date');
    assert.match(o.pickup_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(o.pickup_time, 'scheduled orders keep an explicit pickup_time');
    assert.ok(o.scheduled_at && o.pickup_at, 'scheduled_at/pickup_at set for the scheduling classification');
    assert.equal(o.status, 'Terjadwal');
    assert.equal(o.bag_count, 2, 'combined package keeps the chosen number of kantong');
    assert.equal(o.wash_process, 'Gabung Semua');
  });

  await s.close();
}

// Shared: open the order form and go to step 2 with the Dago address.
const gotoStep2 = async (page) => {
  await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('nav').getByRole('button', { name: 'Order' }).click();
  await page.getByRole('button', { name: /Rumah · Jl Ir Juanda Dago/ }).click();
  await page.getByLabel('Pilih outlet').waitFor();
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
};
const checkAllAgreements = async (page) => {
  const checks = page.locator('form input[type=checkbox]');
  const n = await checks.count();
  for (let i = 0; i < n; i++) if (!(await checks.nth(i).isChecked())) await checks.nth(i).check();
};

// ---------------------------------------------------------------------------
// Scenario 4: photo feature OFF on the server (default until staff/customer
// verified sessions are configured) — no photo UI, satuan not blocked.
// ---------------------------------------------------------------------------
{
  const s = await newScenario({ photoConfig: { enabled: false, canUpload: false } });
  const { page } = s;
  await gotoStep2(page);
  await step('Photo feature off: no upload control and satuan items are not blocked', async () => {
    await page.getByText('Items Satuan', { exact: false }).click();
    await page.getByText('Merk', { exact: false }).first().waitFor();
    await chooseSatuan(page);
    assert.equal(await page.getByLabel('Unggah foto item satuan').count(), 0);
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    assert.equal(await page.getByRole('alert').filter({ hasText: 'foto' }).count(), 0);
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
    assert.equal(s.uploadUrlRequests.length, 0);
  });
  await s.close();
}

// ---------------------------------------------------------------------------
// Scenario 5: feature ON but this customer has no verified session (legacy
// login) — satuan requires a photo, upload is not offered, clear message.
// ---------------------------------------------------------------------------
{
  const s = await newScenario({ photoConfig: { enabled: true, canUpload: false } });
  const { page } = s;
  await gotoStep2(page);
  await step('Photo required but session unverified: upload hidden, satuan blocked with a clear message', async () => {
    await page.getByText('Items Satuan', { exact: false }).click();
    await page.getByText('verifikasi WhatsApp/email', { exact: false }).first().waitFor();
    await chooseSatuan(page);
    assert.equal(await page.getByLabel('Unggah foto item satuan').count(), 0);
    await page.getByRole('button', { name: 'Tambah Item Satuan Ini' }).click();
    await page.getByRole('alert').filter({ hasText: 'verifikasi WhatsApp/email' }).waitFor();
    assert.equal(s.uploadUrlRequests.length, 0);
  });
  await s.close();
}

// ---------------------------------------------------------------------------
// Scenario 6: a failed save shows a friendly message, reports NO personal
// data, and retrying creates exactly one order and one set of tasks.
// ---------------------------------------------------------------------------
{
  const s = await newScenario({
    insertFailMessage:
      'new row violates check constraint "pickup_orders_check". Failing row contains (Asep Rahmat, 085172141494, jl ir juanda dago no.378 bandung).'
  });
  const { page } = s;
  await gotoStep2(page);
  await page.getByText('Paket Laundry Kiloan').click();
  await chooseKiloan(page);
  await fillKiloanBag(page, 0, asLabeled({ bajuRingan: 15, celanaBiasa: 0, celanaJeans: 0, cd: 0, bra: 0 }));
  await page.getByRole('button', { name: 'Tambah Paket Kiloan Ini' }).click();
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('tab', { name: /Periksa & Pesan/, selected: true }).waitFor();
  await page.getByPlaceholder('Nama Anda').fill('Asep Rahmat');
  await checkAllAgreements(page);

  await step('Failed save: friendly message, raw DB text never shown', async () => {
    await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
    await page.getByText('Pesanan gagal disimpan', { exact: false }).first().waitFor();
    assert.equal(await page.getByText('Failing row', { exact: false }).count(), 0);
    assert.equal(s.inserts.filter((i) => i.table === 'pickup_orders').length, 0);
  });
  await step('Failed save: error report carries no payload or personal data', async () => {
    await page.waitForTimeout(500);
    assert.equal(s.reports.length, 1);
    const body = s.reports[0];
    for (const leaked of ['085172141494', 'juanda', 'Asep', 'Titip', 'latitude', 'payload']) {
      assert.ok(!body.includes(leaked), `report leaked "${leaked}": ${body}`);
    }
    const r = JSON.parse(body);
    assert.deepEqual(Object.keys(r).sort(), ['category', 'column', 'context', 'message', 'stage']);
    assert.deepEqual(r.context, { isFuturePickup: false, kiloanLines: 1, satuanLines: 0 });
  });
  await step('Retry after error: exactly one order and one set of driver/CS tasks', async () => {
    s.setInsertFailMessage('');
    await page.getByRole('button', { name: /Pesan Sekarang/ }).click();
    await page.waitForTimeout(2000);
    assert.equal(s.inserts.filter((i) => i.table === 'pickup_orders').length, 1);
    const taskRows = s.inserts.filter((i) => i.table === 'system_tasks').flatMap((i) => i.rows);
    assert.equal(taskRows.length, 2, `system_tasks rows: ${taskRows.length}`);
  });
  await s.close();
}

await step('Login page shows the official logo (legacy mode while WA not configured)', async () => {
  const s = await newScenario();
  const p2 = s.page;
  await p2.goto(APP + '/customer/login', { waitUntil: 'networkidle' });
  const img = p2.getByAltText(/Laundrivery/);
  await img.waitFor();
  const box = await img.boundingBox();
  assert.ok(box.width >= 150 && box.width <= 200, `logo width ${box.width}`);
  assert.equal(await p2.getByText('Laundrivery.', { exact: true }).count(), 0);
  await p2.getByRole('button', { name: /Masuk dengan WhatsApp/ }).waitFor();
  await p2.screenshot({ path: `${OUT}/08-login.png`, fullPage: true });
  await s.close();
});

await step('Login: country picker (Indonesia default) — a Singapore number is sent as +65…', async () => {
  const s = await newScenario();
  const p2 = s.page;
  await p2.goto(APP + '/customer/login', { waitUntil: 'networkidle' });
  const country = p2.getByLabel('Kode negara');
  assert.equal(await country.inputValue(), 'ID');
  assert.ok((await country.locator('option').count()) > 200, 'all countries listed');
  await country.selectOption('SG');
  await p2.locator('#legacy-phone').fill('9123 4567');
  const opened = [];
  await p2.exposeFunction('__recordOpen', (u) => opened.push(u));
  await p2.evaluate(() => {
    window.open = (u) => {
      window.__recordOpen(String(u));
      return null;
    };
  });
  await p2.getByRole('button', { name: /Masuk dengan WhatsApp/ }).click();
  await p2.waitForTimeout(300);
  assert.equal(opened.length, 1);
  assert.match(decodeURIComponent(opened[0]), /\+6591234567/);
  await p2.screenshot({ path: `${OUT}/09-login-foreign.png`, fullPage: true });
  await s.close();
});

// ---------------------------------------------------------------------------
// Pickup point accuracy: a NEW pin must be confirmed once, poor GPS accuracy
// is flagged, pins beyond the 30 km service radius get no outlet, and the map
// can be enlarged to place the pin at the gate.
// ---------------------------------------------------------------------------
{
  const s = await newScenario();
  const { page, ctx } = s;
  await page.goto(APP + '/customer/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('nav').getByRole('button', { name: 'Order' }).click();
  const gps = () => page.getByRole('button', { name: 'GPS saya' }).click();

  await step('Pickup point: a new pin needs "Ya, titik sudah tepat" before step 2', async () => {
    await page.getByRole('button', { name: '+ Alamat baru' }).click();
    await page.getByPlaceholder('Cari nama jalan / komplek / patokan besar').fill('Jl Ir Juanda Dago');
    await page.getByPlaceholder(/^Wajib\. Contoh/).fill('12');
    await ctx.setGeolocation({ latitude: -6.8862, longitude: 107.6132, accuracy: 8 });
    await gps();
    await page.getByText('GPS akurat (±8 m)').waitFor();
    await page.getByText('Pastikan titik jemput').waitFor();
    await page.getByLabel('Pilih outlet').waitFor();
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByText('Periksa titik jemput di peta', { exact: false }).first().waitFor();
    assert.equal(await page.getByRole('tab', { name: /Alamat & Jemput/, selected: true }).count(), 1);
    await page.getByRole('button', { name: 'Ya, titik sudah tepat' }).click();
    await page.getByText('Titik jemput sudah dipastikan', { exact: false }).waitFor();
    await page.getByRole('button', { name: /Lanjut/ }).click();
    await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
  });

  await step('Pickup point: poor GPS accuracy is flagged and the moved pin must be confirmed again', async () => {
    await page.getByRole('tab', { name: /Alamat & Jemput/ }).click();
    await ctx.setGeolocation({ latitude: -6.8866, longitude: 107.6136, accuracy: 150 });
    await gps();
    await page.getByText('Lokasi GPS kurang akurat (±150 m)', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Ya, titik sudah tepat' }).waitFor();
  });

  await step('Pickup point: beyond 30 km there is no outlet and the reason is shown', async () => {
    await ctx.setGeolocation({ latitude: -6.5569, longitude: 107.4431, accuracy: 10 }); // Purwakarta, ~41 km
    await gps();
    await page.getByText('di luar jangkauan layanan', { exact: false }).first().waitFor();
    assert.equal(await page.getByLabel('Pilih outlet').count(), 0);
    await page.getByRole('button', { name: /Lanjut/ }).click();
    assert.equal(await page.getByRole('tab', { name: /Alamat & Jemput/, selected: true }).count(), 1);
  });

  await step('Pickup point: "Perbesar" opens a full-screen map, "Selesai" closes it', async () => {
    await page.getByRole('button', { name: 'Perbesar' }).click();
    const dlg = page.getByRole('dialog', { name: 'Peta titik jemput' });
    await dlg.waitFor();
    const box = await dlg.boundingBox();
    assert.ok(box && box.height > 700, `full-screen height ${box?.height}`);
    const mapH = await page.evaluate(() => {
      const el = document.querySelector('[role=dialog] .leaflet-container');
      return el ? el.getBoundingClientRect().height : -1;
    });
    assert.ok(mapH > 600, `map height in full screen ${mapH}`);
    await page.screenshot({ path: `${OUT}/10-pin-fullscreen.png` });
    await dlg.getByRole('button', { name: 'Selesai' }).click();
    await dlg.waitFor({ state: 'detached' }).catch(() => {});
    assert.equal(await page.getByRole('dialog', { name: 'Peta titik jemput' }).count(), 0);
    // Leaflet's own classes survive the mode switch (React must not overwrite them).
    const h = await page.evaluate(() => document.querySelector('.leaflet-container')?.getBoundingClientRect().height ?? -1);
    assert.ok(h > 200 && h < 300, `inline map height ${h}`);
  });
  await s.close();
}

await step('No scenario ever reached the production database host', async () => {
  assert.deepEqual(productionDbHits, []);
});

await browser.close();
app.kill();
for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
