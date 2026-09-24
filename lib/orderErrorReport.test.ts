import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOrderErrorReport,
  classifyOrderError,
  normalizeOrderErrorReport,
  orderErrorColumnOf,
  sanitizeOrderErrorMessage
} from './orderErrorReport';

const NOT_NULL = 'null value in column "pickup_date" of relation "pickup_orders" violates not-null constraint';

describe('classifyOrderError / orderErrorColumnOf', () => {
  it('classifies common failures and extracts only the column identifier', () => {
    assert.equal(classifyOrderError(NOT_NULL), 'not_null');
    assert.equal(orderErrorColumnOf(NOT_NULL), 'pickup_date');
    assert.equal(classifyOrderError('TypeError: Failed to fetch'), 'network');
    assert.equal(classifyOrderError('duplicate key value violates unique constraint'), 'duplicate');
    assert.equal(classifyOrderError('new row violates row-level security policy'), 'permission');
    assert.equal(classifyOrderError("Could not find the 'x' column in the schema cache"), 'schema');
    assert.equal(classifyOrderError(''), 'unknown');
  });
});

describe('sanitizeOrderErrorMessage — no personal data in logs', () => {
  it('removes row values, quoted values, emails and phone-like numbers', () => {
    const raw =
      'new row violates check constraint. Failing row contains (Budi, 081234567890, Jl. Mawar 1). ' +
      "Key (customer_phone)=(081234567890) already exists; value 'Jl. Melati 5' email budi@mail.com +62 812-3456-7890";
    const out = sanitizeOrderErrorMessage(raw);
    for (const leaked of ['Budi', '081234567890', 'Mawar', 'Melati', 'budi@mail.com', '812-3456-7890']) {
      assert.ok(!out.includes(leaked), `leaked ${leaked}: ${out}`);
    }
    assert.ok(out.length <= 200);
  });
  it('keeps the technical part of a not-null error', () => {
    assert.match(sanitizeOrderErrorMessage(NOT_NULL), /pickup_date.*not-null/);
  });
});

describe('buildOrderErrorReport / normalizeOrderErrorReport', () => {
  it('sends only whitelisted, bounded fields', () => {
    const r = buildOrderErrorReport(NOT_NULL, { isFuturePickup: false, kiloanLines: 2, satuanLines: 999 });
    assert.deepEqual(Object.keys(r).sort(), ['category', 'column', 'context', 'message', 'stage']);
    assert.deepEqual(r.context, { isFuturePickup: false, kiloanLines: 2, satuanLines: 50 });
  });
  it('server drops extra fields (payload, phone, address) and rejects other stages', () => {
    const n = normalizeOrderErrorReport({
      stage: 'pickup_order_create',
      category: 'not_null',
      column: 'pickup_date',
      message: 'Key (phone)=(081234567890) x',
      payload: { customer_phone: '081234567890', address: 'Jl. Mawar' },
      context: { isFuturePickup: true, kiloanLines: 1, satuanLines: 0, phone: '0812' }
    });
    assert.ok(n);
    assert.equal(JSON.stringify(n).includes('081234567890'), false);
    assert.equal(JSON.stringify(n).includes('Mawar'), false);
    assert.deepEqual(n.context, { isFuturePickup: true, kiloanLines: 1, satuanLines: 0 });
    assert.equal(normalizeOrderErrorReport({ stage: 'other' }), null);
    assert.equal(normalizeOrderErrorReport(null), null);
    assert.equal(normalizeOrderErrorReport({ stage: 'pickup_order_create', column: 'x; drop' })?.column, null);
  });
});
