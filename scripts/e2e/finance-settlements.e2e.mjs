// Build against the local mock (server code inlines NEXT_PUBLIC_SUPABASE_URL), then run:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock npm run build
//   node --import tsx scripts/e2e/finance-settlements.e2e.mjs
// E2E (API): pembayaran bagi hasil / THR — owner only, validated, soft void, audited. Mock DB only.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state } from './mockPostgrest.mjs';
import { signStaffSession } from '../../lib/staffAuth/core.ts';

const APP = 'http://localhost:3213';
const STAFF_SECRET = 'e2e-staff-secret-e2e-staff-secret-e2e';
const OUTLET = '0a000000-0000-4000-8000-00000000000a';

await startMock(54331);
state.outlets = [{ id: OUTLET, name: 'Laundrivery Dago' }];
state.employees = [
  { id: '1', name: 'Owner', role: 'owner' },
  { id: '2', name: 'Spv', role: 'supervisor' }
];
state.finance_settlements = [];
state.audit_logs = [];
state.error_logs = [];

const app = spawn('npx', ['next', 'start', '-p', '3213'], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: { ...process.env, PORT: '3213', NODE_ENV: 'production', SUPABASE_URL: 'http://localhost:54331', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', STAFF_SESSION_SECRET: STAFF_SECRET },
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
const post = async (body, { cookie = staff('1', 'owner'), origin = APP } = {}) => {
  const res = await fetch(APP + '/api/owner/finance-settlements', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const list = async (cookie = staff('1', 'owner')) => {
  const res = await fetch(APP + '/api/owner/finance-settlements', { headers: cookie ? { cookie } : {} });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

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

let id = '';
await step('Owner records a bagi hasil payment; audited', async () => {
  const r = await post({ outletId: OUTLET, kind: 'profit_share', amount: 250000, paidAt: today, source: 'bank', note: 'Agustus' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  id = r.json.settlement.id;
  assert.equal(state.finance_settlements.length, 1);
  assert.equal(state.finance_settlements[0].created_by_name, 'Owner');
  assert.equal(state.audit_logs.at(-1).action, 'finance_settlement_created');
  assert.equal(Number(state.audit_logs.at(-1).amount), 250000);
});
await step('Owner lists payments', async () => {
  const r = await list();
  assert.equal(r.status, 200);
  assert.equal(r.json.settlements.length, 1);
});
await step('Supervisor and forged roles refused; no session → 401 with relogin code; cross-site 403', async () => {
  assert.equal((await post({ outletId: OUTLET, kind: 'thr', amount: 1, paidAt: today, source: 'bank' }, { cookie: staff('2', 'supervisor') })).status, 403);
  assert.equal((await post({ outletId: OUTLET, kind: 'thr', amount: 1, paidAt: today, source: 'bank' }, { cookie: staff('2', 'owner') })).status, 403);
  assert.equal((await list(staff('2', 'supervisor'))).status, 403);
  const none = await post({ outletId: OUTLET, kind: 'thr', amount: 1, paidAt: today, source: 'bank' }, { cookie: '' });
  assert.equal(none.status, 401);
  assert.equal(none.json.code, 'STAFF_SESSION_REQUIRED');
  assert.equal((await post({ outletId: OUTLET, kind: 'thr', amount: 1, paidAt: today, source: 'bank' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal(state.finance_settlements.length, 1);
});
await step('Invalid input refused (wrong source for bagi hasil, future date, unknown outlet, zero)', async () => {
  assert.equal((await post({ outletId: OUTLET, kind: 'profit_share', amount: 1, paidAt: today, source: 'dana_thr' })).status, 400);
  assert.equal((await post({ outletId: OUTLET, kind: 'thr', amount: 1, paidAt: '2999-01-01', source: 'bank' })).status, 400);
  assert.equal((await post({ outletId: '0b000000-0000-4000-8000-00000000000b', kind: 'thr', amount: 1, paidAt: today, source: 'bank' })).status, 400);
  assert.equal((await post({ outletId: OUTLET, kind: 'thr', amount: 0, paidAt: today, source: 'bank' })).status, 400);
  assert.equal(state.finance_settlements.length, 1);
});
await step('Void needs a reason, keeps the row (soft), is audited, and is idempotent', async () => {
  assert.equal((await post({ action: 'void', id, reason: '' })).status, 400);
  const r = await post({ action: 'void', id, reason: 'salah nominal' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(state.finance_settlements.length, 1);
  assert.ok(state.finance_settlements[0].voided_at);
  assert.equal(state.finance_settlements[0].void_reason, 'salah nominal');
  assert.equal(state.audit_logs.at(-1).action, 'finance_settlement_voided');
  const again = await post({ action: 'void', id, reason: 'lagi' });
  assert.equal(again.json.already, true);
});

process.kill(-app.pid, 'SIGKILL');
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) {
  console.log(appLog.slice(-3000));
  process.exit(1);
}
process.exit(0);
