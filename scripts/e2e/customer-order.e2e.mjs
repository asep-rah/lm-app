// Run after `npm run build`:
//   npm i --no-save playwright-core && CHROMIUM_PATH=/path/to/chrome node scripts/e2e/customer-order.e2e.mjs
// UI E2E (mobile viewport) of the customer dashboard: Bandung outlet, 3-step
// order form, state kept across steps, single order on double tap, and the
// Rp15.000 → Rp1.000 detail. ALL Supabase traffic is intercepted (no prod access).
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
const tables = {
  outlets: [DAGO, SEMARANG],
  transactions: [TX],
  pickup_orders: [],
  app_settings: [{ id: 1, dynamic_services: JSON.stringify([
    { id: 's1', name: 'Cuci Kering Lipat', type: 'kg', price: 5000 },
    { id: 's2', name: 'Bedcover Single', type: 'pcs', price: 25000 }
  ]), outlet_overrides: '{}', receipt_terms: 'S&K uji coba', promos_data: '[]' }],
  customers: [{ phone: '085172141494', name: 'Asep Rahmat', deposit_balance: 0 }],
  customer_addresses: [
    { id: 'a1', customer_phone: '085172141494', label_name: 'Lainnya', full_address: 'Hotel sheraton bandung', is_primary: false, latitude: -6.87, longitude: 107.61 },
    { id: 'a2', customer_phone: '085172141494', label_name: 'Rumah', full_address: 'jl ir juanda dago no.378 bandung', is_primary: true, latitude: -6.886, longitude: 107.613 },
    { id: 'a3', customer_phone: '085172141494', label_name: 'Rumah', full_address: 'Jl supriyadi semarang', is_primary: false, latitude: -6.99, longitude: 110.45 }
  ]
};
const inserts = [];
const outbound = [];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: -6.886, longitude: 107.613 }, permissions: ['geolocation'], locale: 'id-ID'
});
await ctx.addInitScript(() => {
  localStorage.setItem('laundry_customer_phone', '085172141494');
});
await ctx.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === 'localhost') {
    if (url.pathname.startsWith('/api/road-distance')) return route.fulfill({ json: { km: 2.5 } });
    return route.continue();
  }
  outbound.push(url.hostname);
  if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ status: 204, body: '' });
  const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)/);
  if (!m) return route.fulfill({ status: 200, json: [] });
  const table = m[1];
  const method = route.request().method();
  if (method === 'POST') {
    const body = route.request().postDataJSON();
    const rows = (Array.isArray(body) ? body : [body]).map((r, i) => ({ id: `new-${inserts.length}-${i}`, ...r }));
    inserts.push({ table, rows });
    if (table === 'pickup_orders') tables.pickup_orders.push(...rows);
    return route.fulfill({ status: 201, json: rows });
  }
  if (method === 'PATCH') return route.fulfill({ status: 200, json: [] });
  let rows = tables[table] || [];
  if (table === 'pickup_orders' && url.searchParams.get('order_number')) {
    const want = url.searchParams.get('order_number').replace(/^eq\./, '');
    rows = rows.filter((r) => r.order_number === want);
  }
  if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${rows.length}` }, body: '' });
  const accept = route.request().headers()['accept'] || '';
  if (accept.includes('vnd.pgrst.object')) {
    return rows.length ? route.fulfill({ json: rows[0] }) : route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } });
  }
  return route.fulfill({ json: rows, headers: { 'content-range': `0-${rows.length}/${rows.length}` } });
});

const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
};

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
await step('Order step 1: duplicate "Rumah" labels are distinguishable; pick address, outlet & courier', async () => {
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
await step('Order step 2: requires a service', async () => {
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('tab', { name: /Layanan/, selected: true }).waitFor();
  await page.getByRole('button', { name: /Lanjut/ }).click();
  await page.getByRole('alert').filter({ hasText: 'Pilih minimal 1 paket' }).waitFor();
  await page.getByText('Paket Laundry Kiloan').click();
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
  assert.match(summary, /Cuci Kering Lipat · 3 Kg/);
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
await step('Double tap "Pesan Sekarang" creates exactly ONE pickup order with full payload', async () => {
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
  const orders = inserts.filter((i) => i.table === 'pickup_orders');
  assert.equal(orders.length, 1, `pickup_orders inserts: ${orders.length}`);
  const o = orders[0].rows[0];
  assert.equal(o.outlet_id, DAGO.id);
  assert.equal(o.customer_phone, '085172141494');
  assert.equal(o.courier_type, 'THIRD_PARTY');
  assert.equal(o.status, 'Menunggu Kurir');
  assert.equal(o.delivery_fee, 18000);
  assert.ok(o.latitude && o.longitude);
  assert.match(o.address, /jl ir juanda dago/);
  assert.match(o.notes, /Catatan: Titip satpam/);
  assert.match(o.notes, /Est\. Tagihan: Rp 33\.000/);
  assert.match(o.notes, /\[S&K\] Disetujui/);
  assert.equal(o.items[0].name, 'Cuci Kering Lipat');
  assert.equal(o.items[0].weight, 3);
  const tasks = inserts.filter((i) => i.table === 'system_tasks');
  assert.ok(tasks.length >= 2, 'driver + cs tasks created');
  await page.screenshot({ path: `${OUT}/07-after-order.png`, fullPage: true });
});

await step('Login page shows the official logo (legacy mode while WA not configured)', async () => {
  const p2 = await ctx.newPage();
  await ctx.clearCookies();
  await p2.goto(APP + '/customer/login', { waitUntil: 'networkidle' });
  const img = p2.getByAltText(/Laundrivery/);
  await img.waitFor();
  const box = await img.boundingBox();
  assert.ok(box.width >= 150 && box.width <= 200, `logo width ${box.width}`);
  assert.equal(await p2.getByText('Laundrivery.', { exact: true }).count(), 0);
  await p2.getByRole('button', { name: /Masuk dengan WhatsApp/ }).waitFor();
  await p2.screenshot({ path: `${OUT}/08-login.png`, fullPage: true });
});

await browser.close();
app.kill();
for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log('outbound hosts (all intercepted):', [...new Set(outbound)].join(', '));
process.exit(failed ? 1 : 0);
