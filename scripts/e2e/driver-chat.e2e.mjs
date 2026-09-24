// Build against the local mock (server code inlines NEXT_PUBLIC_SUPABASE_URL), then run:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock npm run build
//   node --import tsx scripts/e2e/driver-chat.e2e.mjs
// E2E (API): driver ↔ customer order chat against `next start` with the
// in-memory PostgREST mock — authorization, open/closed trips, unread counts,
// read receipts. No real database.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state } from './mockPostgrest.mjs';
import { signSession } from '../../lib/customerAuth/core.ts';
import { signStaffSession } from '../../lib/staffAuth/core.ts';

const APP = 'http://localhost:3210';
const CUSTOMER_SECRET = 'e2e-customer-secret-e2e-customer-secret';
const STAFF_SECRET = 'e2e-staff-secret-e2e-staff-secret-e2e';

await startMock(54331);
const ids = {
  a: '0a000000-0000-4000-8000-00000000000a', // 0811 · Andi · on the way (open)
  b: '0b000000-0000-4000-8000-00000000000b', // 0822 · Budi · delivering (open)
  c: '0c000000-0000-4000-8000-00000000000c', // 0811 · Andi · delivered (closed)
  d: '0d000000-0000-4000-8000-00000000000d' // 0811 · no driver yet (closed)
};
state.pickup_orders = [
  { id: ids.a, order_number: 'ORD-20260924-0001', customer_name: 'Citra', customer_phone: '6281111111111', driver_name: 'Andi', status: 'Driver Menuju Lokasi' },
  { id: ids.b, order_number: 'ORD-20260924-0002', customer_name: 'Dedi', customer_phone: '082222222222', driver_name: 'Budi', status: 'Driver Mengantar' },
  { id: ids.c, order_number: 'ORD-20260924-0003', customer_name: 'Citra', customer_phone: '081111111111', driver_name: 'Andi', status: 'Terkirim' },
  { id: ids.d, order_number: 'ORD-20260924-0004', customer_name: 'Citra', phone_number: '081111111111', driver_name: null, status: 'Menunggu Kurir' }
];
state.employees = [
  { id: '1', name: 'Andi', role: 'driver' },
  { id: '2', name: 'Budi', role: 'driver' },
  { id: '3', name: 'Kasir A', role: 'kasir' }
];
state.order_driver_chats = [];

const env = {
  ...process.env,
  PORT: '3210',
  NODE_ENV: 'production',
  SUPABASE_URL: 'http://localhost:54331',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  CUSTOMER_AUTH_SECRET: CUSTOMER_SECRET,
  STAFF_SESSION_SECRET: STAFF_SECRET,
  CUSTOMER_LEGACY_LOGIN_ENABLED: 'true'
};
const app = spawn('npx', ['next', 'start', '-p', '3210'], {
  cwd: new URL('../../', import.meta.url).pathname,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true // own process group, so next-server is stopped with it
});
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

const customerCookie = (phone) => `ldrv_cust_session=${signSession({ phone, method: 'whatsapp' }, CUSTOMER_SECRET)}`;
const staffCookie = (sid, role) => `ldrv_staff_session=${signStaffSession({ sid, role }, STAFF_SECRET)}`;
const call = async (path, { cookie = '', method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(APP + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(method === 'POST' ? { origin: APP } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json };
};
const cust = (path, opts = {}) => call(`/api/customer/driver-chat${path}`, opts);
const drv = (path, opts = {}) => call(`/api/staff/driver-chat${path}`, opts);

let passed = 0;
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log('PASS |', name);
  } catch (e) {
    failed++;
    console.log('FAIL |', name, '\n   ', e.message);
  }
};

const citra = customerCookie('081111111111');
const andi = staffCookie('1', 'driver');

await step('Customer opens the chat of her running trip (driver assigned, on the way)', async () => {
  const r = await cust(`?order=${ids.a}`, { cookie: citra });
  assert.equal(r.status, 200);
  assert.equal(r.json.open, true);
  assert.equal(r.json.driverName, 'Andi');
  assert.deepEqual(r.json.messages, []);
});
await step('Customer sends a message; it is stored as sender customer', async () => {
  const r = await cust('', { cookie: citra, method: 'POST', body: { order: ids.a, message: '  Pak, pagar warna hijau ya  ' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.message.message, 'Pak, pagar warna hijau ya');
  assert.equal(r.json.message.sender_type, 'customer');
  assert.equal(state.order_driver_chats.length, 1);
  assert.equal(state.order_driver_chats[0].pickup_order_id, ids.a);
});
await step('Customer cannot read or write another customer\'s order', async () => {
  assert.equal((await cust(`?order=${ids.b}`, { cookie: citra })).status, 404);
  assert.equal((await cust('', { cookie: citra, method: 'POST', body: { order: ids.b, message: 'x' } })).status, 404);
});
await step('Closed trips are read-only (delivered, or no driver yet)', async () => {
  const done = await cust(`?order=${ids.c}`, { cookie: citra });
  assert.equal(done.status, 200);
  assert.equal(done.json.open, false);
  assert.equal((await cust('', { cookie: citra, method: 'POST', body: { order: ids.c, message: 'halo' } })).status, 409);
  assert.equal((await cust('', { cookie: citra, method: 'POST', body: { order: ids.d, message: 'halo' } })).status, 409);
});
await step('Bad input: empty message, non-uuid order, cross-site POST', async () => {
  assert.equal((await cust('', { cookie: citra, method: 'POST', body: { order: ids.a, message: '   ' } })).status, 400);
  assert.equal((await cust('?order=1%20or%201=1', { cookie: citra })).status, 400);
  assert.equal((await cust('', { cookie: citra, method: 'POST', body: { order: ids.a, message: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403);
});
await step('Long messages are cut to 1000 characters', async () => {
  const r = await cust('', { cookie: citra, method: 'POST', body: { order: ids.a, message: 'y'.repeat(1500) } });
  assert.equal(r.status, 200);
  assert.equal(r.json.message.message.length, 1000);
  state.order_driver_chats.pop();
});
await step('Driver sees 1 unread message on his trip; opening it marks it read', async () => {
  const u = await drv('?unread=1', { cookie: andi });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.deepEqual(u.json.counts, { [ids.a]: 1 });
  const r = await drv(`?order=${ids.a}`, { cookie: andi });
  assert.equal(r.status, 200);
  assert.equal(r.json.customerName, 'Citra');
  assert.equal(r.json.messages.length, 1);
  assert.deepEqual((await drv('?unread=1', { cookie: andi })).json.counts, {});
  assert.ok(state.order_driver_chats[0].read_at, 'customer message marked read');
});
await step('Driver replies; the customer gets an unread badge and a read receipt on her message', async () => {
  const r = await drv('', { cookie: andi, method: 'POST', body: { order: ids.a, message: 'Siap kak, 5 menit lagi sampai' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.message.sender_type, 'driver');
  assert.equal(r.json.message.sender_name, 'Andi');
  const u = await cust('?unread=1', { cookie: citra });
  assert.deepEqual(u.json.counts, { [ids.a]: 1 });
  const g = await cust(`?order=${ids.a}`, { cookie: citra });
  assert.equal(g.json.messages.length, 2);
  assert.ok(g.json.messages[0].read_at, 'her own message shows as read');
  assert.deepEqual((await cust('?unread=1', { cookie: citra })).json.counts, {});
});
await step('Another driver, a non-driver role, or no session cannot use the driver chat', async () => {
  assert.equal((await drv(`?order=${ids.a}`, { cookie: staffCookie('2', 'driver') })).status, 404);
  assert.equal((await drv('', { cookie: staffCookie('2', 'driver'), method: 'POST', body: { order: ids.a, message: 'x' } })).status, 404);
  assert.equal((await drv(`?order=${ids.a}`, { cookie: staffCookie('3', 'kasir') })).status, 403);
  // A forged role in the cookie does not help: the role is re-read from employees.
  assert.equal((await drv(`?order=${ids.a}`, { cookie: staffCookie('3', 'driver') })).status, 403);
  assert.equal((await drv(`?order=${ids.a}`)).status, 401);
  assert.equal((await drv(`?order=${ids.a}`, { cookie: 'ldrv_staff_session=forged.token' })).status, 401);
});
await step('Driver cannot write after the trip is over', async () => {
  assert.equal((await drv('', { cookie: andi, method: 'POST', body: { order: ids.c, message: 'x' } })).status, 409);
});
await step('Legacy login (no session): phone from the header, own orders only', async () => {
  assert.equal((await cust(`?order=${ids.a}`, { headers: { 'x-customer-phone': '081111111111' } })).status, 200);
  assert.equal((await cust(`?order=${ids.a}`, { headers: { 'x-customer-phone': '082222222222' } })).status, 404);
  assert.equal((await cust(`?order=${ids.a}`)).status, 401);
});
await step('Verified session wins: a different phone in the header is refused', async () => {
  assert.equal((await cust(`?order=${ids.a}`, { cookie: citra, headers: { 'x-customer-phone': '082222222222' } })).status, 403);
});
await step('No server error was logged', async () => {
  assert.deepEqual(state.error_logs, []);
});

process.kill(-app.pid, 'SIGKILL');
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) {
  console.log(appLog.slice(-3000));
  process.exit(1);
}
process.exit(0);
