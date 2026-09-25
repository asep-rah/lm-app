// Build against the local mock (server code inlines NEXT_PUBLIC_SUPABASE_URL), then run:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock npm run build
//   node --import tsx scripts/e2e/pickup-location.e2e.mjs
// E2E (API) against `next start` + the in-memory PostgREST mock (no real DB):
// - /api/customer/order/create: pin required, 30 km service radius, outlet
//   penuh / coming soon refused;
// - /api/staff/pickup-pin: only the assigned driver on the way, accurate GPS,
//   updates the order + the same customer's saved address, audited;
// - /api/customer/addresses: a customer only reads/changes their own rows.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state } from './mockPostgrest.mjs';
import { signSession } from '../../lib/customerAuth/core.ts';
import { signStaffSession } from '../../lib/staffAuth/core.ts';

const APP = 'http://localhost:3212';
const CUSTOMER_SECRET = 'e2e-customer-secret-e2e-customer-secret';
const STAFF_SECRET = 'e2e-staff-secret-e2e-staff-secret-e2e';
const OUTLET = '0a000000-0000-4000-8000-00000000000a';
const FULL = '0b000000-0000-4000-8000-00000000000b';
const SOON = '0c000000-0000-4000-8000-00000000000c';
const ORDER = '1a000000-0000-4000-8000-00000000000a';
const ORDER_DONE = '1b000000-0000-4000-8000-00000000000b';
const ORDER_OTHER_ADDR = '1c000000-0000-4000-8000-00000000000c';
const ADDR = '2a000000-0000-4000-8000-00000000000a';
const ADDR_OTHER = '2b000000-0000-4000-8000-00000000000b';
const NEAR = { latitude: -6.886, longitude: 107.613 };
const GATE = { lat: -6.8871, lon: 107.6142 };
const PURWAKARTA = { latitude: -6.5569, longitude: 107.4431 };

await startMock(54331);
state.outlets = [
  { id: OUTLET, name: 'Laundrivery Dago', latitude: -6.8853, longitude: 107.6195, is_overcapacity: false, is_coming_soon: false },
  { id: FULL, name: 'Penuh', latitude: -6.8853, longitude: 107.6195, is_overcapacity: true, is_coming_soon: false },
  { id: SOON, name: 'Soon', latitude: -6.8853, longitude: 107.6195, is_overcapacity: false, is_coming_soon: true }
];
state.employees = [
  { id: '1', name: 'Andi', role: 'driver' },
  { id: '2', name: 'Budi', role: 'driver' },
  { id: '3', name: 'Kasir', role: 'kasir' }
];
state.pickup_orders = [
  { id: ORDER, order_number: 'ORD-20260925-0001', status: 'Driver Menuju Lokasi', driver_name: 'Andi', outlet_id: OUTLET, customer_phone: '081111111111', ...NEAR, address_id: ADDR },
  { id: ORDER_DONE, order_number: 'ORD-20260925-0002', status: 'Barang Dibawa ke Outlet', driver_name: 'Andi', outlet_id: OUTLET, customer_phone: '081111111111', ...NEAR, address_id: ADDR },
  { id: ORDER_OTHER_ADDR, order_number: 'ORD-20260925-0003', status: 'Driver Menuju Lokasi', driver_name: 'Andi', outlet_id: OUTLET, customer_phone: '081111111111', ...NEAR, address_id: ADDR_OTHER }
];
state.customer_addresses = [
  { id: ADDR, customer_phone: '6281111111111', full_address: 'Jl Dago No. 1', ...NEAR },
  { id: ADDR_OTHER, customer_phone: '082222222222', full_address: 'Rumah orang lain', ...NEAR }
];
state.system_tasks = [];
state.audit_logs = [];
state.error_logs = [];

const app = spawn('npx', ['next', 'start', '-p', '3212'], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: '3212',
    NODE_ENV: 'production',
    SUPABASE_URL: 'http://localhost:54331',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    CUSTOMER_AUTH_SECRET: CUSTOMER_SECRET,
    STAFF_SESSION_SECRET: STAFF_SECRET
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
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

const customer = `ldrv_cust_session=${signSession({ phone: '081111111111', method: 'whatsapp' }, CUSTOMER_SECRET)}`;
const staff = (sid, role) => `ldrv_staff_session=${signStaffSession({ sid, role }, STAFF_SECRET)}`;
const post = async (path, body, { cookie = '', origin = APP } = {}) => {
  const res = await fetch(APP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
let seq = 1000;
const order = (extra = {}) =>
  post(
    '/api/customer/order/create',
    {
      order_number: `ORD-20260925-${seq++}`,
      outlet_id: OUTLET,
      customer_name: 'Citra',
      address: 'Jl Dago No. 1',
      items: [{ name: 'Cuci Kering Lipat', type: 'kg', weight: 3, qty: 1, price: 21000 }],
      ...NEAR,
      ...extra
    },
    { cookie: customer }
  );
const pin = (body, cookie = staff('1', 'driver')) => post('/api/staff/pickup-pin', body, { cookie });

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

await step('Order: pin within 30 km is accepted', async () => {
  const r = await order();
  assert.equal(r.status, 200, JSON.stringify(r.json));
});
await step('Order: no pin / beyond 30 km refused (nothing stored)', async () => {
  const before = state.pickup_orders.length;
  const none = await order({ latitude: null, longitude: null });
  assert.equal(none.status, 400);
  assert.match(none.json.error, /titik jemput/i);
  const far = await order(PURWAKARTA);
  assert.equal(far.status, 400);
  assert.match(far.json.error, /luar jangkauan.*30 km/);
  assert.equal(state.pickup_orders.length, before);
});
await step('Order: outlet penuh → 409, coming soon → 400', async () => {
  assert.equal((await order({ outlet_id: FULL })).status, 409);
  assert.equal((await order({ outlet_id: SOON })).status, 400);
});

await step('Pin correction: assigned driver on the way saves the gate; order + saved address updated; audited', async () => {
  const r = await pin({ orderId: ORDER, ...GATE, accuracy: 9 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.addressUpdated, true);
  const o = state.pickup_orders.find((x) => x.id === ORDER);
  assert.deepEqual([Number(o.latitude), Number(o.longitude)], [GATE.lat, GATE.lon]);
  const a = state.customer_addresses.find((x) => x.id === ADDR);
  assert.deepEqual([Number(a.latitude), Number(a.longitude)], [GATE.lat, GATE.lon]);
  const log = state.audit_logs.at(-1);
  assert.equal(log.action, 'pickup_pin_corrected');
  assert.equal(log.user_name, 'Andi');
  assert.equal(log.meta.accuracy_m, 9);
  assert.deepEqual(log.meta.from, { lat: NEAR.latitude, lon: NEAR.longitude });
  assert.ok(log.meta.moved_m > 100 && log.meta.moved_m < 250, String(log.meta.moved_m));
});
await step('Pin correction: another customer\'s saved address is never changed', async () => {
  const r = await pin({ orderId: ORDER_OTHER_ADDR, ...GATE, accuracy: 9 });
  assert.equal(r.status, 200);
  assert.equal(r.json.addressUpdated, false);
  const a = state.customer_addresses.find((x) => x.id === ADDR_OTHER);
  assert.deepEqual([a.latitude, a.longitude], [NEAR.latitude, NEAR.longitude]);
});
await step('Pin correction: other driver 404, cashier 403, after pickup 409, inaccurate / far GPS 400', async () => {
  const auditBefore = state.audit_logs.length;
  assert.equal((await pin({ orderId: ORDER, ...GATE, accuracy: 9 }, staff('2', 'driver'))).status, 404);
  assert.equal((await pin({ orderId: ORDER, ...GATE, accuracy: 9 }, staff('3', 'kasir'))).status, 403);
  assert.equal((await pin({ orderId: ORDER, ...GATE, accuracy: 9 }, staff('3', 'driver'))).status, 403, 'role re-read from employees');
  assert.equal((await pin({ orderId: ORDER_DONE, ...GATE, accuracy: 9 })).status, 409);
  assert.equal((await pin({ orderId: ORDER, ...GATE, accuracy: 80 })).status, 400);
  assert.equal((await pin({ orderId: ORDER, ...GATE })).status, 400);
  assert.equal((await pin({ orderId: ORDER, lat: PURWAKARTA.latitude, lon: PURWAKARTA.longitude, accuracy: 5 })).status, 400);
  assert.equal(state.audit_logs.length, auditBefore);
});
await step('Pin correction: no session → 401 STAFF_SESSION_REQUIRED; cross-site 403; bad id 400', async () => {
  const none = await post('/api/staff/pickup-pin', { orderId: ORDER, ...GATE, accuracy: 9 });
  assert.equal(none.status, 401);
  assert.equal(none.json.code, 'STAFF_SESSION_REQUIRED');
  assert.equal((await post('/api/staff/pickup-pin', { orderId: ORDER, ...GATE, accuracy: 9 }, { cookie: staff('1', 'driver'), origin: 'https://evil.example' })).status, 403);
  assert.equal((await pin({ orderId: 'nope', ...GATE, accuracy: 9 })).status, 400);
});

// --- saved addresses: server-only writes (/api/customer/addresses) --------------
const addresses = (body, { cookie = customer, origin = APP } = {}) => post('/api/customer/addresses', body, { cookie, origin });
const listAddresses = async (cookie = customer) => {
  const res = await fetch(APP + '/api/customer/addresses', { headers: { cookie } });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const other = state.customer_addresses.find((x) => x.id === ADDR_OTHER);
const otherBefore = JSON.stringify(other);

await step('Addresses: a customer lists only their own rows (08… session matches a 62… row)', async () => {
  const r = await listAddresses();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.addresses.map((a) => a.id), [ADDR]);
  assert.equal(r.json.addresses[0].is_primary, true);
});
let added = '';
await step('Addresses: save a new one (stored under the session phone), make it primary', async () => {
  const r = await addresses({ action: 'save', address: { id: 'local_x', label: 'Kantor', full_address: 'Jl Merdeka No. 5', is_primary: true, latitude: -6.9, longitude: 107.61 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.addresses.length, 2);
  const row = r.json.addresses.find((a) => a.label === 'Kantor');
  added = row.id;
  assert.equal(row.is_primary, true);
  assert.equal(r.json.addresses.filter((a) => a.is_primary).length, 1);
  assert.equal(state.customer_addresses.find((x) => x.id === added).customer_phone, '081111111111');
});
await step("Addresses: another customer's row is never changed or deleted (update by its id → new own row; delete → 404)", async () => {
  const r = await addresses({ action: 'save', address: { id: ADDR_OTHER, label: 'Hack', full_address: 'Jl Hack No. 1' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.addresses.length, 3);
  assert.equal((await addresses({ action: 'delete', id: ADDR_OTHER })).status, 404);
  assert.equal((await addresses({ action: 'primary', id: ADDR_OTHER })).status, 404);
  assert.equal(JSON.stringify(state.customer_addresses.find((x) => x.id === ADDR_OTHER)), otherBefore);
});
await step('Addresses: edit own, switch primary, delete the primary → the oldest becomes primary', async () => {
  const e = await addresses({ action: 'save', address: { id: ADDR, label: 'Rumah', full_address: 'Jl Dago No. 1A' } });
  assert.equal(e.json.addresses.find((a) => a.id === ADDR).full_address, 'Jl Dago No. 1A');
  const p = await addresses({ action: 'primary', id: ADDR });
  assert.equal(p.json.addresses.find((a) => a.is_primary).id, ADDR);
  const d = await addresses({ action: 'delete', id: ADDR });
  assert.equal(d.status, 200);
  assert.ok(!d.json.addresses.some((a) => a.id === ADDR));
  assert.equal(d.json.addresses.filter((a) => a.is_primary).length, 1);
});
await step('Addresses: bad input 400; phone of someone else with a session 403; cross-site 403; unknown action 400', async () => {
  assert.equal((await addresses({ action: 'save', address: { full_address: 'x' } })).status, 400);
  assert.equal((await addresses({ action: 'save', phone: '082222222222', address: { full_address: 'Jl Dago No. 9' } })).status, 403);
  assert.equal((await addresses({ action: 'save', address: { full_address: 'Jl Dago No. 9' } }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await addresses({ action: 'drop' })).status, 400);
});

process.kill(-app.pid, 'SIGKILL');
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) {
  console.log(appLog.slice(-3000));
  process.exit(1);
}
process.exit(0);
