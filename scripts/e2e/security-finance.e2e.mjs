// Build against the local mock with the payment secret published (as in production today):
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331 NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_e2e_mock \
//   NEXT_PUBLIC_PAYMENT_OPS_SECRET=e2e-public-ops-secret-e2e-public npm run build
//   node --import tsx scripts/e2e/security-finance.e2e.mjs
// E2E (API): security phase 1 + finance controls against `next start` and the in-memory PostgREST mock.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startMock, state, writes } from './mockPostgrest.mjs';
import { signStaffSession } from '../../lib/staffAuth/core.ts';

const APP = 'http://localhost:3214';
const STAFF_SECRET = 'e2e-staff-secret-e2e-staff-secret-e2e';
const OPS = 'e2e-public-ops-secret-e2e-public';
const OUTLET = '0a000000-0000-4000-8000-00000000000a';
const OUTLET_B = '0b000000-0000-4000-8000-00000000000b'; // void test; keeps OUTLET's drawer untouched

await startMock(54331);
state.outlets = [{ id: OUTLET, name: 'Laundrivery Dago' }, { id: OUTLET_B, name: 'Laundrivery Buah Batu' }];
state.employees = [
  { id: '1', name: 'Owner', role: 'owner', username: 'owner' },
  { id: '3', name: 'Kasir A', role: 'kasir', username: 'kasir' },
  { id: '4', name: 'CS Rina', role: 'cs', username: 'cs' },
  { id: '5', name: 'Fina', role: 'finance', username: 'fina' },
  { id: '6', name: 'Spv Budi', role: 'supervisor', username: 'spv' }
];
state.role_permissions = [];
state.customers = [{ id: 'c1', phone: '081234567890', name: 'Bu Ani', registered_by: 'Kasir A' }];
state.employee_loans = [
  { id: 'L1', employee_name: 'Kasir A', amount: 100000, status: 'pending' },
  { id: 'L2', employee_name: 'Kasir A', amount: 50000, status: 'pending' },
  { id: 'L3', employee_name: 'Driver D', amount: 40000, status: 'pending' },
  { id: 'L4', employee_name: 'CS Rina', amount: 30000, status: 'pending' }
];
state.transactions = [
  { id: 't1', outlet_id: OUTLET, amount: 100000, delivery_fee: 0, order_type: 'Offline', payment_method: 'Cash', is_paid: true, payment_status: 'paid', status: 'Selesai', created_at: '2026-01-10T03:00:00.000Z' },
  { id: 't2', receipt_number: 'LDV-T2', outlet_id: OUTLET, amount: 45000, payment_method: 'QRIS', is_paid: false, payment_status: 'pending', status: 'menunggu_pembayaran', created_at: new Date().toISOString() },
  { id: 't3', receipt_number: 'LDV-T3', outlet_id: OUTLET_B, amount: 60000, payment_method: 'Cash', is_paid: true, payment_status: 'paid', status: 'Selesai', created_at: new Date().toISOString() }
];
state.system_tasks = [{ id: 'st2', source_type: 'PAYMENT_VERIFY', source_id: 't2', status: 'pending', title: 'Konfirmasi Pembayaran LDV-T2' }];
state.cashflow_logs = [{ id: 'cf3', reference_id: 't3', amount: 60000 }];
state.delete_requests = [{ id: 'dr3', transaction_id: 't3', status: 'pending' }];
state.pickup_orders = [];
state.membership_logs = [{ id: 'm1', outlet_id: OUTLET, price: 50000, order_type: 'Offline', created_at: '2026-01-11T03:00:00.000Z' }];
state.expenses = [{ id: 'e1', outlet_id: OUTLET, amount: 30000, category: '600006 · ATK', created_at: '2026-01-12T03:00:00.000Z' }];
state.cash_deposits = [{ id: 'd1', outlet_id: OUTLET, amount_cash: 20000, admin_fee: 0, net_deposit_amount: 20000, status: 'BALANCED', paid_at: '2026-01-13T03:00:00.000Z', created_at: '2026-01-13T02:00:00.000Z' }];
state.cash_closings = [];
state.app_settings = [{ id: 1, outlet_books: {}, coa_categories: '[]', dynamic_services: '[]' }];
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

await step('CS confirms a transfer through the server (session, service-role write, audited)', async () => {
  const body = { transactionId: 't2', proofUrl: 'https://example.test/bukti.jpg', receipt: 'LDV-T2', amount: 45000, note: 'Bukti transfer dikonfirmasi CS (CS Rina)' };
  assert.equal((await call('/api/pay/mark-manual', { body })).status, 401);
  const before = writes.length;
  const r = await call('/api/pay/mark-manual', { body, cookie: staff('4', 'cs') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t2 = state.transactions.find((t) => t.id === 't2');
  assert.equal(t2.is_paid, true);
  assert.ok(t2.paid_at);
  const txWrites = writes.slice(before).filter((w) => w.table === 'transactions');
  assert.ok(txWrites.length > 0 && txWrites.every((w) => w.key === 'test-service-role'), JSON.stringify(txWrites));
  assert.equal(state.system_tasks.find((t) => t.id === 'st2').status, 'completed');
  // mark-manual writes its audit row without awaiting it.
  for (let i = 0; i < 20 && !state.audit_logs.some((a) => a.entity_id === 't2'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(state.audit_logs.some((a) => a.action === 'PAYMENT_MANUAL_VERIFIED' && a.entity_id === 't2'), JSON.stringify(state.audit_logs.map((a) => a.action)));
});
await step('Void: owner only, reason required, service-role write, audited, idempotent', async () => {
  const body = { transactionId: 't3', reason: 'Owner menyetujui permintaan hapus' };
  assert.equal((await call('/api/owner/void-transaction', { body })).status, 401);
  assert.equal((await call('/api/owner/void-transaction', { body, cookie: staff('3', 'kasir') })).status, 403);
  assert.equal((await call('/api/owner/void-transaction', { body: { transactionId: 't3', reason: '' }, cookie: staff('1', 'owner') })).status, 400);
  assert.equal((await call('/api/owner/void-transaction', { body: { transactionId: 'nope', reason: 'salah input' }, cookie: staff('1', 'owner') })).status, 404);
  assert.notEqual(state.transactions.find((t) => t.id === 't3').is_void, true);
  const before = writes.length;
  const r = await call('/api/owner/void-transaction', { body, cookie: staff('1', 'owner') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t3 = state.transactions.find((t) => t.id === 't3');
  assert.equal(t3.is_void, true);
  assert.ok(t3.voided_at);
  assert.ok(writes.slice(before).every((w) => w.key === 'test-service-role'));
  assert.equal(state.cashflow_logs.filter((c) => c.reference_id === 't3').length, 0);
  assert.ok(state.audit_logs.some((a) => a.action === 'transaction_voided' && a.entity_id === 't3'));
  const again = await call('/api/owner/void-transaction', { body, cookie: staff('1', 'owner') });
  assert.equal(again.json?.already, true);
});

await step('app_settings: owner saves; finance only COA; kasir refused; unknown column refused; audited', async () => {
  const body = { attempts: [{ dynamic_services: '[{"id":"svc1","price":9000}]' }] };
  assert.equal((await call('/api/owner/app-settings', { body })).status, 401);
  assert.equal((await call('/api/owner/app-settings', { body, cookie: staff('3', 'kasir') })).status, 403);
  assert.equal((await call('/api/owner/app-settings', { body, cookie: staff('5', 'finance') })).status, 403);
  assert.equal((await call('/api/owner/app-settings', { body: { attempts: [{ is_admin: true }] }, cookie: staff('1', 'owner') })).status, 400);
  const coa = await call('/api/owner/app-settings', { body: { attempts: [{ coa_categories: '["600006 · ATK"]' }] }, cookie: staff('5', 'finance') });
  assert.equal(coa.status, 200, JSON.stringify(coa.json));
  assert.equal(state.app_settings[0].coa_categories, '["600006 · ATK"]');
  const ok = await call('/api/owner/app-settings', { body, cookie: staff('1', 'owner') });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(state.app_settings[0].dynamic_services, /9000/);
  assert.ok(state.audit_logs.some((a) => a.action === 'app_settings_updated' && a.meta?.keys?.includes('dynamic_services')));
});
await step('Expense create: staff session; created_by = logged-in staff; bad source refused; requisition not doubled; closed period refused', async () => {
  const body = { op: 'create', outletId: OUTLET, category: '600006 · ATK', amount: 12000, description: 'lakban', paidFrom: 'laci' };
  assert.equal((await call('/api/staff/expense', { body })).status, 401);
  assert.equal((await call('/api/staff/expense', { body: { ...body, paidFrom: 'brankas' }, cookie: staff('3', 'kasir') })).status, 400);
  assert.equal((await call('/api/staff/expense', { body: { ...body, amount: -5 }, cookie: staff('3', 'kasir') })).status, 400);
  const r = await call('/api/staff/expense', { body, cookie: staff('3', 'kasir') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = state.expenses.at(-1);
  assert.equal(row.created_by, 'Kasir A');
  assert.equal(row.paid_from, 'laci');
  const req = { ...body, paidFrom: 'bank', requisitionId: 'pr-1', proofUrl: 'data:image/png;base64,xx' };
  assert.equal((await call('/api/staff/expense', { body: req, cookie: staff('5', 'finance') })).status, 200);
  const again = await call('/api/staff/expense', { body: req, cookie: staff('5', 'finance') });
  assert.equal(again.json?.already, true);
  assert.equal(state.expenses.filter((e) => e.requisition_id === 'pr-1').length, 1);
  assert.equal(state.expenses.find((e) => e.requisition_id === 'pr-1').proof_url, undefined);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  state.finance_period_locks.push({ outlet_id: OUTLET_B, locked_through: today });
  const locked = await call('/api/staff/expense', { body: { ...body, outletId: OUTLET_B }, cookie: staff('3', 'kasir') });
  assert.equal(locked.status, 409, JSON.stringify(locked.json));
  state.finance_period_locks = state.finance_period_locks.filter((l) => l.outlet_id !== OUTLET_B);
});
await step('Expense revision: owner / finance only; before-after audited; closed period refused', async () => {
  const id = state.expenses.find((e) => e.description === 'lakban').id;
  const body = { op: 'update', id, amount: 15000, description: 'lakban + tali' };
  assert.equal((await call('/api/staff/expense', { body, cookie: staff('3', 'kasir') })).status, 403);
  const r = await call('/api/staff/expense', { body, cookie: staff('5', 'finance') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(Number(state.expenses.find((e) => e.id === id).amount), 15000);
  const log = state.audit_logs.find((a) => a.action === 'expense_revised' && a.entity_id === id);
  assert.equal(log?.meta?.before?.amount, 12000);
  const saved = state.finance_period_locks;
  state.finance_period_locks = [{ outlet_id: OUTLET, locked_through: '2026-01-31' }];
  const locked = await call('/api/staff/expense', { body: { op: 'update', id: 'e1', amount: 1 }, cookie: staff('1', 'owner') });
  state.finance_period_locks = saved;
  assert.equal(locked.status, 409, JSON.stringify(locked.json));
  assert.equal(Number(state.expenses.find((e) => e.id === 'e1').amount), 30000);
});
await step('Membership log: price & commission from the package (not the browser); commission owner = registering staff', async () => {
  const body = { outletId: OUTLET, phone: '081234567890', package: 'Gold', orderType: 'Offline', price: 1, commission: 999999 };
  assert.equal((await call('/api/staff/membership-log', { body })).status, 401);
  assert.equal((await call('/api/staff/membership-log', { body: { ...body, package: 'Diamond' }, cookie: staff('4', 'cs') })).status, 400);
  const r = await call('/api/staff/membership-log', { body, cookie: staff('4', 'cs') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = state.membership_logs.at(-1);
  assert.equal(Number(row.price), 500000);
  assert.equal(Number(row.balance_added), 550000);
  assert.equal(Number(row.commission), 10000);
  assert.equal(row.processed_by, 'CS Rina');
  assert.equal(row.commission_owner, 'Kasir A');
  assert.ok(state.audit_logs.some((a) => a.action === 'membership_sold'));
});
await step('Kasbon decisions: owner only; approve once; paid only after approval; audited', async () => {
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L1', action: 'approve' }, cookie: staff('3', 'kasir') })).status, 403);
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L2', action: 'paid' }, cookie: staff('1', 'owner') })).status, 409);
  const ok = await call('/api/owner/employee-loan', { body: { id: 'L1', action: 'approve' }, cookie: staff('1', 'owner') });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const l1 = state.employee_loans.find((l) => l.id === 'L1');
  assert.equal(l1.status, 'Active');
  assert.equal(l1.approved_by, 'Owner');
  assert.equal(Number(l1.monthly_deduction), 20000);
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L1', action: 'approve' }, cookie: staff('1', 'owner') })).status, 409);
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L1', action: 'paid' }, cookie: staff('1', 'owner') })).status, 200);
  assert.equal(state.employee_loans.find((l) => l.id === 'L1').status, 'Paid');
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L2', action: 'reject' }, cookie: staff('1', 'owner') })).status, 200);
  assert.equal(state.employee_loans.find((l) => l.id === 'L2').status, 'Rejected');
  assert.ok(state.audit_logs.some((a) => a.action === 'employee_loan_approve' && a.entity_id === 'L1'));
});

await step('Supervisor (default rights): saves prices; stale bagi hasil / buku copies kept; cannot change bagi hasil; decides kasbon', async () => {
  const ov = { o1: { svc1: { price: 11000 } }, __profit_share: { o1: 30 }, __outlet_books: { o1: { cash: 10 } } };
  state.app_settings[0].outlet_overrides = JSON.stringify(ov);
  const stale = { ...ov, o1: { svc1: { price: 12000 } }, __profit_share: { o1: 99 }, __outlet_books: { o1: { cash: 0 } } };
  const r = await call('/api/owner/app-settings', { body: { attempts: [{ outlet_overrides: JSON.stringify(stale), basic_salary: state.app_settings[0].basic_salary ?? null }] }, cookie: staff('6', 'supervisor') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const saved = JSON.parse(state.app_settings[0].outlet_overrides);
  assert.equal(saved.o1.svc1.price, 12000);
  assert.deepEqual(saved.__profit_share, { o1: 30 });
  assert.deepEqual(saved.__outlet_books, { o1: { cash: 10 } });
  const share = await call('/api/owner/app-settings', { body: { attempts: [{ profit_share_by_outlet: { o1: 90 } }] }, cookie: staff('6', 'supervisor') });
  assert.equal(share.status, 403);
  assert.equal(share.json?.code, 'PERMISSION_DENIED');
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L3', action: 'approve' }, cookie: staff('6', 'supervisor') })).status, 200);
  assert.equal((await call('/api/owner/void-transaction', { body: { transactionId: 't1', reason: 'coba void' }, cookie: staff('6', 'supervisor') })).status, 403);
});
await step('Hak akses: owner only; owner row cannot be set; granted right works; reset returns to default; audited', async () => {
  const mine = await call('/api/staff/permissions', { method: 'GET', cookie: staff('3', 'kasir') });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.permissions, []);
  assert.equal(mine.json.matrix, undefined);
  const ownerView = await call('/api/staff/permissions', { method: 'GET', cookie: staff('1', 'owner') });
  assert.ok(ownerView.json.matrix?.supervisor?.includes('kasbon.decide'));
  assert.equal((await call('/api/owner/role-permissions', { body: { role: 'kasir', permissions: ['kasbon.decide'] }, cookie: staff('6', 'supervisor') })).status, 403);
  assert.equal((await call('/api/owner/role-permissions', { body: { role: 'owner', permissions: [] }, cookie: staff('1', 'owner') })).status, 400);
  const grant = await call('/api/owner/role-permissions', { body: { role: 'kasir', permissions: ['kasbon.decide', 'root.all'] }, cookie: staff('1', 'owner') });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.deepEqual(state.role_permissions.find((r) => r.role === 'kasir').permissions, ['kasbon.decide']);
  assert.equal((await call('/api/owner/employee-loan', { body: { id: 'L4', action: 'reject' }, cookie: staff('3', 'kasir') })).status, 200);
  const deny = await call('/api/owner/role-permissions', { body: { role: 'supervisor', permissions: [] }, cookie: staff('1', 'owner') });
  assert.equal(deny.status, 200);
  assert.equal((await call('/api/owner/app-settings', { body: { attempts: [{ receipt_terms: 'baru' }] }, cookie: staff('6', 'supervisor') })).status, 403);
  assert.equal((await call('/api/owner/role-permissions', { body: { role: 'supervisor', reset: true }, cookie: staff('1', 'owner') })).status, 200);
  assert.equal(state.role_permissions.some((r) => r.role === 'supervisor'), false);
  assert.equal((await call('/api/owner/app-settings', { body: { attempts: [{ receipt_terms: 'baru' }] }, cookie: staff('6', 'supervisor') })).status, 200);
  assert.ok(state.audit_logs.some((a) => a.action === 'role_permissions_updated' && a.entity_id === 'kasir'));
  assert.ok(state.audit_logs.some((a) => a.action === 'role_permissions_reset' && a.entity_id === 'supervisor'));
});

process.kill(-app.pid, 'SIGKILL');
console.log(`\n${passed}/${passed + failed} passed`);
if (failed) {
  console.log(appLog.slice(-3000));
  process.exit(1);
}
process.exit(0);
