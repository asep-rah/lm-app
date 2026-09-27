// Build against the local mock with the payment secret published (as in production today):
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock \
//   NEXT_PUBLIC_PAYMENT_OPS_SECRET=e2e-public-ops-secret-e2e-public npm run build
//   node --import tsx scripts/e2e/security-finance.e2e.mjs
// E2E (API): security phase 1 + finance controls against `next start` and the in-memory PostgREST mock.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state } from './mockPostgrest.mjs';
import { signStaffSession } from '../../lib/staffAuth/core.ts';

const APP = 'http://localhost:3214';
const STAFF_SECRET = 'e2e-staff-secret-e2e-staff-secret-e2e';
const OPS = 'e2e-public-ops-secret-e2e-public';
const OUTLET = '0a000000-0000-4000-8000-00000000000a';

await startMock(54331);
state.outlets = [{ id: OUTLET, name: 'Laundrivery Dago' }];
state.employees = [
  { id: '1', name: 'Owner', role: 'owner', username: 'owner' },
  { id: '3', name: 'Kasir A', role: 'kasir', username: 'kasir' }
];
state.transactions = [
  { id: 't1', outlet_id: OUTLET, amount: 100000, delivery_fee: 0, order_type: 'Offline', payment_method: 'Cash', is_paid: true, payment_status: 'paid', status: 'Selesai', created_at: '2026-01-10T03:00:00.000Z' }
];
state.membership_logs = [{ id: 'm1', outlet_id: OUTLET, price: 50000, order_type: 'Offline', created_at: '2026-01-11T03:00:00.000Z' }];
state.expenses = [{ id: 'e1', outlet_id: OUTLET, amount: 30000, category: '600006 · ATK', created_at: '2026-01-12T03:00:00.000Z' }];
state.cash_deposits = [{ id: 'd1', outlet_id: OUTLET, amount_cash: 20000, admin_fee: 0, net_deposit_amount: 20000, status: 'BALANCED', paid_at: '2026-01-13T03:00:00.000Z', created_at: '2026-01-13T02:00:00.000Z' }];
state.cash_closings = [];
state.app_settings = [{ id: 1, outlet_books: {} }];
state.finance_settlements = [];
state.finance_period_locks = [];
state.audit_logs = [];
state.error_logs = [];

const app = spawn('npx', ['next', 'start', '-p', '3214'], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: '3214',
    NODE_ENV: 'production',
    SUPABASE_URL: 'http://localhost:54331',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    STAFF_SESSION_SECRET: STAFF_SECRET,
    PAYMENT_OPS_SECRET: OPS
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

const staff = (sid, role) => `ldrv_staff_session=${signStaffSession({ sid, role }, STAFF_SECRET)}`;
const call = async (path, { method = 'POST', body, cookie = '', headers = {} } = {}) => {
  const res = await fetch(APP + path, {
    method,
    headers: { 'content-type': 'application/json', origin: APP, ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
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

// Simulate is served only when BOTH the deploy env is not production (Vercel: VERCEL_ENV)
// AND mock payments are enabled; here mock payments are off, as in production.
await step('Without mock payments: /api/mayar/simulate does not exist (no free deposit / paid status)', async () => {
  const r = await call('/api/mayar/simulate', { body: { transactionId: 't1' } });
  assert.equal(r.status, 404);
  assert.equal(state.transactions[0].is_paid, true);
});
await step('Published ops secret + claimed staffId is not enough; staff session required', async () => {
  const r = await call('/api/deposit/mutate', {
    body: { action: 'credit', phone: '081111111111', amount: 1000000, staffId: 'owner', role: 'owner' },
    headers: { authorization: `Bearer ${OPS}` }
  });
  assert.equal(r.status, 401, JSON.stringify(r.json));
  assert.equal(r.json.code, 'STAFF_SESSION_REQUIRED');
  const e = await call('/api/owner/employees', { method: 'GET', headers: { authorization: `Bearer ${OPS}` } });
  assert.ok([401, 405].includes(e.status), String(e.status));
});
await step('With a staff session the role comes from employees (body role ignored)', async () => {
  const r = await call('/api/deposit/mutate', { body: { action: 'credit', phone: '', amount: 0, role: 'owner' }, cookie: staff('3', 'kasir') });
  assert.equal(r.status, 400, 'passed auth as the logged-in kasir, then input validation');
});
await step('Cashier setoran via server: session required; cashier = logged-in staff; admin fee expense', async () => {
  assert.equal((await call('/api/staff/cash-deposit', { body: { outletId: OUTLET, amountCash: 50000, method: 'INDOMARET_ALFAMART', adminFee: 2500 } })).status, 401);
  const r = await call('/api/staff/cash-deposit', {
    body: { outletId: OUTLET, amountCash: 50000, method: 'INDOMARET_ALFAMART', adminFee: 2500, note: 'setor sore' },
    cookie: staff('3', 'kasir')
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = state.cash_deposits.at(-1);
  assert.equal(row.status, 'PENDING');
  assert.equal(row.kasir_id, '3');
  assert.equal(Number(row.net_deposit_amount), 47500);
  assert.equal(Number(state.expenses.at(-1).amount), 2500);
  assert.equal(state.audit_logs.at(-1).action, 'cash_deposit_submitted');
});
await step('QRIS setoran creation needs a staff session', async () => {
  assert.equal((await call('/api/mayar/create-deposit-qris', { body: { outlet_id: OUTLET, net_deposit_amount: 10000 } })).status, 401);
});
await step('Closing shift: system cash = drawer balance of the ledger; difference stored for the journal', async () => {
  // 100.000 tunai + 50.000 top up tunai − 30.000 ATK − 20.000 setoran − 2.500 admin fee = 97.500
  const r = await call('/api/staff/cash-closing', { body: { outletId: OUTLET, physicalCash: 95000, notes: 'shift pagi' }, cookie: staff('3', 'kasir') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.expected, r.json.physical, r.json.difference], [97500, 95000, -2500]);
  const c = state.cash_closings.at(-1);
  assert.equal(c.expected_source, 'ledger');
  assert.equal(Number(c.cash_difference), -2500);
  assert.equal(state.expenses.filter((e) => /selisih/i.test(String(e.category || ''))).length, 0, 'no double loss expense');
  // A second closing right after: the first difference is already in the ledger.
  const again = await call('/api/staff/cash-closing', { body: { outletId: OUTLET, physicalCash: 95000 }, cookie: staff('3', 'kasir') });
  assert.equal(again.json.expected, 95000);
  assert.equal(again.json.difference, 0);
});
await step('Tutup buku: owner only; current month refused; reopening needs a reason; audited', async () => {
  assert.equal((await call('/api/owner/period-lock', { body: { outletId: OUTLET, month: '2026-01' }, cookie: staff('3', 'kasir') })).status, 403);
  const ok = await call('/api/owner/period-lock', { body: { outletId: OUTLET, month: '2026-01' }, cookie: staff('1', 'owner') });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(state.finance_period_locks[0].locked_through, '2026-01-31');
  const nowMonth = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  assert.equal((await call('/api/owner/period-lock', { body: { outletId: OUTLET, month: nowMonth }, cookie: staff('1', 'owner') })).status, 400);
  assert.equal((await call('/api/owner/period-lock', { body: { outletId: OUTLET, month: '2025-12' }, cookie: staff('1', 'owner') })).status, 400);
  const reopen = await call('/api/owner/period-lock', { body: { outletId: OUTLET, month: '2025-12', reason: 'koreksi nota Januari' }, cookie: staff('1', 'owner') });
  assert.equal(reopen.status, 200);
  assert.equal(state.finance_period_locks[0].locked_through, '2025-12-31');
  assert.equal(state.audit_logs.at(-1).action, 'finance_period_reopened');
  const list = await call('/api/owner/period-lock', { method: 'GET', cookie: staff('1', 'owner') });
  assert.equal(list.json.locks.length, 1);
});
await step('Mayar payout with fee is recorded (owner)', async () => {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const r = await call('/api/owner/finance-settlements', {
    body: { outletId: OUTLET, kind: 'gateway_payout', amount: 97000, fee: 3000, paidAt: today, source: 'clearing' },
    cookie: staff('1', 'owner')
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(Number(state.finance_settlements.at(-1).fee), 3000);
});

process.kill(-app.pid, 'SIGKILL');
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) {
  console.log(appLog.slice(-3000));
  process.exit(1);
}
process.exit(0);
