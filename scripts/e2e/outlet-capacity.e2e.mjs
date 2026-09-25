// Build against the local mock (server code inlines NEXT_PUBLIC_SUPABASE_URL), then run:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock npm run build
//   node --import tsx scripts/e2e/outlet-capacity.e2e.mjs
// E2E (API): "outlet penuh" switch — owner/supervisor only, audited, no DB access beyond the mock.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state } from './mockPostgrest.mjs';
import { signStaffSession } from '../../lib/staffAuth/core.ts';

const APP = 'http://localhost:3211';
const STAFF_SECRET = 'e2e-staff-secret-e2e-staff-secret-e2e';
const OUTLET = '0a000000-0000-4000-8000-00000000000a';

await startMock(54331);
state.outlets = [{ id: OUTLET, name: 'Laundrivery Dago', is_overcapacity: false }];
state.employees = [
  { id: '1', name: 'Owner', role: 'owner' },
  { id: '2', name: 'Spv', role: 'supervisor' },
  { id: '3', name: 'Kasir', role: 'kasir' }
];
state.audit_logs = [];

const app = spawn('npx', ['next', 'start', '-p', '3211'], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: { ...process.env, PORT: '3211', NODE_ENV: 'production', SUPABASE_URL: 'http://localhost:54331', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', STAFF_SESSION_SECRET: STAFF_SECRET },
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

const staff = (sid, role) => `ldrv_staff_session=${signStaffSession({ sid, role }, STAFF_SECRET)}`;
const post = async (body, { cookie = '', origin = APP } = {}) => {
  const res = await fetch(APP + '/api/staff/outlet-capacity', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

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

await step('Supervisor marks the outlet full; audited', async () => {
  const r = await post({ outletId: OUTLET, full: true }, { cookie: staff('2', 'supervisor') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(state.outlets[0].is_overcapacity, true);
  assert.equal(state.audit_logs.at(-1).action, 'outlet_marked_full');
  assert.equal(state.audit_logs.at(-1).user_name, 'Spv');
});
await step('Owner opens it again; audited', async () => {
  const r = await post({ outletId: OUTLET, full: false }, { cookie: staff('1', 'owner') });
  assert.equal(r.status, 200);
  assert.equal(state.outlets[0].is_overcapacity, false);
  assert.equal(state.audit_logs.at(-1).action, 'outlet_reopened');
});
await step('Same value twice: no extra audit row', async () => {
  const before = state.audit_logs.length;
  assert.equal((await post({ outletId: OUTLET, full: false }, { cookie: staff('1', 'owner') })).status, 200);
  assert.equal(state.audit_logs.length, before);
});
await step('Cashier refused; forged role in the cookie does not help', async () => {
  assert.equal((await post({ outletId: OUTLET, full: true }, { cookie: staff('3', 'kasir') })).status, 403);
  assert.equal((await post({ outletId: OUTLET, full: true }, { cookie: staff('3', 'owner') })).status, 403);
  assert.equal(state.outlets[0].is_overcapacity, false);
});
await step('No session / forged token / cross-site / bad input', async () => {
  const none = await post({ outletId: OUTLET, full: true });
  assert.equal(none.status, 401);
  assert.equal(none.json.code, 'STAFF_SESSION_REQUIRED', 'UI offers "Masuk ulang"');
  assert.equal((await post({ outletId: OUTLET, full: true }, { cookie: 'ldrv_staff_session=x.y' })).status, 401);
  assert.equal((await post({ outletId: OUTLET, full: true }, { cookie: staff('1', 'owner'), origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ outletId: 'nope', full: true }, { cookie: staff('1', 'owner') })).status, 400);
  assert.equal((await post({ outletId: OUTLET, full: 'yes' }, { cookie: staff('1', 'owner') })).status, 400);
  assert.equal((await post({ outletId: '0b000000-0000-4000-8000-00000000000b', full: true }, { cookie: staff('1', 'owner') })).status, 404);
  assert.equal(state.outlets[0].is_overcapacity, false);
});

process.kill(-app.pid, 'SIGKILL');
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) {
  console.log(appLog.slice(-3000));
  process.exit(1);
}
process.exit(0);
