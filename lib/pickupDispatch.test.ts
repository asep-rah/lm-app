import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendlyPickupOrderError } from './pickupDispatch';

describe('friendlyPickupOrderError never leaks raw database text to the customer', () => {
  it('maps the not-null constraint error to a friendly message', () => {
    const msg = friendlyPickupOrderError(
      'null value in column "pickup_date" of relation "pickup_orders" violates not-null constraint'
    );
    assert.doesNotMatch(msg, /pickup_date|relation|constraint|null value/i);
    assert.match(msg, /data pesanan.*belum lengkap/i);
  });

  it('maps a network failure to a connectivity message', () => {
    assert.match(friendlyPickupOrderError('TypeError: Failed to fetch'), /koneksi internet/i);
  });

  it('maps a duplicate/unique violation to a "already saved" message', () => {
    assert.match(friendlyPickupOrderError('duplicate key value violates unique constraint "pickup_orders_pkey"'), /sudah tersimpan/i);
  });

  it('falls back to a generic message for unknown/empty errors', () => {
    assert.match(friendlyPickupOrderError(''), /gagal disimpan/i);
    assert.match(friendlyPickupOrderError(undefined), /gagal disimpan/i);
    assert.match(friendlyPickupOrderError('some obscure internal code XYZ-500'), /gagal disimpan/i);
  });
});
