import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requestDeliveryServer } from './deliveryRequestServer';

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const log: string[] = [];
  const q = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const rows = () => (tables[table] || []).filter((r) => filters.every(([k, v]) => String(r[k]) === String(v)));
    const api = {
      select: () => api,
      eq: (k: string, v: unknown) => (filters.push([k, v]), api),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      limit: async () => ({ data: rows(), error: null }),
      insert: (ins: Row[]) => ({
        select: async () => {
          const row = { id: `${table}-${(tables[table] ||= []).length + 1}`, ...ins[0] };
          tables[table].push(row);
          log.push(`insert ${table} ${String(row.assigned_to_role ?? row.status ?? '')}`);
          return { data: [row], error: null };
        }
      }),
      update: (patch: Row) => ({
        eq: async (_k: string, id: unknown) => {
          const r = (tables[table] || []).find((x) => String(x.id) === String(id));
          if (r) Object.assign(r, patch);
          log.push(`update ${table} ${String(patch.status)}`);
          return { error: null };
        }
      })
    };
    return api;
  };
  return { db: { from: q } as unknown as SupabaseClient, tables, log };
}
const input = (over: Partial<Parameters<typeof requestDeliveryServer>[1]> = {}) => ({ kind: 'pickup' as const, orderId: 'p1', phone: '081234567890', today: '2026-09-24', ...over });

describe('requestDeliveryServer', () => {
  it('own pickup: status Siap Diantar + 3 tasks; second call is a no-op', async () => {
    const f = fakeDb({ pickup_orders: [{ id: 'p1', status: 'Selesai Dicuci', customer_phone: '6281234567890', notes: 'x' }] });
    const r = await requestDeliveryServer(f.db, input());
    assert.deepEqual(r, { ok: true, pickupId: 'p1', already: false });
    assert.equal(f.tables.pickup_orders[0].status, 'Siap Diantar');
    assert.deepEqual(f.log.filter((l) => l.startsWith('insert system_tasks')).length, 3);
    const again = await requestDeliveryServer(f.db, input());
    assert.deepEqual(again, { ok: true, pickupId: 'p1', already: true });
    assert.equal(f.log.filter((l) => l.startsWith('insert system_tasks')).length, 3, 'no new tasks');
  });
  it("another customer's order → 404, nothing written", async () => {
    const f = fakeDb({ pickup_orders: [{ id: 'p1', status: 'Selesai', customer_phone: '089999999999' }] });
    const r = await requestDeliveryServer(f.db, input());
    assert.deepEqual(r, { ok: false, status: 404, error: 'Pesanan tidak ditemukan.' });
    assert.deepEqual(f.log, []);
  });
  it('POS transaction without a card: creates one (Siap Diantar, transaction_id) and marks the transaction', async () => {
    const f = fakeDb({ transactions: [{ id: 't1', receipt_number: 'TRX-1', customer_phone: '081234567890', outlet_id: null, pickup_id: null }], pickup_orders: [] });
    const r = await requestDeliveryServer(f.db, input({ kind: 'transaction', orderId: 't1', address: 'Jl. A' }));
    assert.ok(r.ok);
    const card = f.tables.pickup_orders[0];
    assert.deepEqual([card.status, card.transaction_id, card.customer_phone], ['Siap Diantar', 't1', '081234567890']);
    assert.equal(f.tables.transactions[0].status, 'Siap Diantar');
  });
});
