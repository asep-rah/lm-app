import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creditCustomerDeposit, isRegisteredCustomer } from './depositTopup';

/** Minimal fake of the supabase-js calls creditCustomerDeposit makes. */
function fakeDb(opts: { customers?: Record<string, { deposit_balance: number; registered_by?: string }>; insertError?: { code?: string; message: string }; rpc?: boolean }) {
  const customers = { ...(opts.customers || {}) };
  const credits = new Set<string>();
  const log: string[] = [];
  const db = {
    customers,
    log,
    from(table: string) {
      return {
        select() {
          return {
            in: (_col: string, phones: string[]) => ({
              limit: async () => ({ data: phones.filter((p) => customers[p]).map((p) => ({ phone: p, ...customers[p] })), error: null })
            }),
            eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: credits.has(id) ? { payment_id: id } : null, error: null }) })
          };
        },
        async insert(rows: Array<Record<string, unknown>>) {
          log.push(`insert ${table}`);
          if (table === 'customers') {
            if (opts.insertError) return { error: opts.insertError };
            for (const r of rows) customers[String(r.phone)] = { deposit_balance: Number(r.deposit_balance || 0), registered_by: r.registered_by as string };
          }
          if (table === 'deposit_payment_credits') rows.forEach((r) => credits.add(String(r.payment_id)));
          return { error: null };
        },
        update(v: { deposit_balance: number }) {
          return { eq: async (_c: string, phone: string) => ((customers[phone].deposit_balance = v.deposit_balance), { error: null }) };
        }
      };
    },
    ...(opts.rpc
      ? {
          async rpc(fn: string, args: { p_phone: string; p_amount: number; p_payment_id: string }) {
            log.push(`rpc ${fn}`);
            // Like customer_phone_keys(): 62… and 08… are the same customer.
            const phone = args.p_phone.replace(/^62/, '0');
            if (credits.has(args.p_payment_id)) return { data: customers[phone].deposit_balance, error: null };
            credits.add(args.p_payment_id);
            // Like the production RPC: only updates here, because the row exists already.
            if (!customers[phone]) return { data: null, error: { message: 'null value in column "registered_by" violates not-null constraint' } };
            customers[phone].deposit_balance += args.p_amount;
            return { data: customers[phone].deposit_balance, error: null };
          }
        }
      : {})
  };
  return db;
}

describe('creditCustomerDeposit', () => {
  it('new number + staff: creates the customer with registered_by, then the RPC credits it', async () => {
    const db = fakeDb({ rpc: true });
    const out = await creditCustomerDeposit(db, '6280000000099', 50000, 'pos-1', { registeredBy: 'Kasir A' });
    assert.deepEqual(out, { balance: 50000, error: null, already: false });
    assert.deepEqual(db.customers['080000000099'], { deposit_balance: 50000, registered_by: 'Kasir A' });
    assert.deepEqual(db.log, ['insert customers', 'rpc credit_customer_deposit']);
  });
  it('new number without staff (gateway webhook): refused, nothing created or credited', async () => {
    const db = fakeDb({ rpc: true });
    const out = await creditCustomerDeposit(db, '080000000099', 10000, 'mayar:x');
    assert.match(String(out.error?.message), /belum terdaftar/);
    assert.deepEqual(db.log, []);
    assert.deepEqual(db.customers, {});
  });
  it('existing customer: no insert; the same payment id twice credits once', async () => {
    const db = fakeDb({ rpc: true, customers: { '080000000001': { deposit_balance: 1000 } } });
    await creditCustomerDeposit(db, '080000000001', 20000, 'mayar:dup');
    const again = await creditCustomerDeposit(db, '080000000001', 20000, 'mayar:dup');
    assert.equal(again.balance, 21000);
    assert.ok(!db.log.includes('insert customers'));
  });
  it('concurrent creation (23505) is treated as "row exists"', async () => {
    const db = fakeDb({ rpc: true, insertError: { code: '23505', message: 'duplicate key' } });
    const out = await creditCustomerDeposit(db, '080000000099', 5000, 'pos-2', { registeredBy: 'Kasir A' });
    assert.ok(db.log.includes('rpc credit_customer_deposit'));
    assert.match(String(out.error?.message), /registered_by/, 'fake RPC still sees no row here; real DB would');
  });
  it('without the RPC (fallback path) the same payment id is credited once', async () => {
    const db = fakeDb({ customers: { '080000000001': { deposit_balance: 0 } } });
    await creditCustomerDeposit(db, '080000000001', 7000, 'pos-3');
    const again = await creditCustomerDeposit(db, '080000000001', 7000, 'pos-3');
    assert.equal(again.already, true);
    assert.equal(db.customers['080000000001'].deposit_balance, 7000);
  });
  it('isRegisteredCustomer matches 08/62 variants', async () => {
    const db = fakeDb({ customers: { '080000000001': { deposit_balance: 0 } } });
    assert.deepEqual(await isRegisteredCustomer(db, '6280000000001'), { registered: true, error: null });
    assert.deepEqual(await isRegisteredCustomer(db, '080000000099'), { registered: false, error: null });
  });
});
