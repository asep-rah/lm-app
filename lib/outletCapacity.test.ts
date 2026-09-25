import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canSetOutletCapacity,
  isOutletOverCapacity,
  nearestOpenOutlet,
  nearestServingOutletKm,
  noOutletReason,
  pickNearestOpenOutlets
} from './outletCapacity';

const DAGO = { id: 'dago', name: 'Dago', latitude: -6.8853, longitude: 107.6195 };
const HERE = { lat: -6.886, lon: 107.613 };

describe('outlet capacity is a manual switch only', () => {
  it('an outlet is full only when marked (no automatic order-count rule)', () => {
    assert.equal(isOutletOverCapacity(DAGO), false);
    assert.equal(isOutletOverCapacity({ ...DAGO, is_overcapacity: true }), true);
    assert.deepEqual(pickNearestOpenOutlets([DAGO], HERE).map((o) => o.id), ['dago']);
  });
  it('full, coming soon and outlets without a location are not offered', () => {
    assert.deepEqual(pickNearestOpenOutlets([{ ...DAGO, is_overcapacity: true }], HERE), []);
    assert.deepEqual(pickNearestOpenOutlets([{ ...DAGO, is_coming_soon: true }], HERE), []);
    assert.deepEqual(pickNearestOpenOutlets([{ ...DAGO, latitude: null, longitude: null }], HERE), []);
    assert.deepEqual(pickNearestOpenOutlets([DAGO], null), []);
  });
  it('the customer sees the real reason', () => {
    assert.equal(noOutletReason([{ ...DAGO, is_overcapacity: true }]), 'full');
    assert.equal(noOutletReason([{ ...DAGO, latitude: 0, longitude: 0 }]), 'no_outlet');
    assert.equal(noOutletReason([{ ...DAGO, is_coming_soon: true }]), 'no_outlet');
    assert.equal(noOutletReason([]), 'no_outlet');
    assert.equal(noOutletReason([{ ...DAGO, is_overcapacity: true }, { ...DAGO, id: 'b' }]), 'no_outlet');
  });
  it('only outlets within the 30 km service radius are offered; farther pins get "out_of_range"', () => {
    const LEMBANG = { lat: -6.8117, lon: 107.6175 }; // ~8 km
    const PURWAKARTA = { lat: -6.5569, lon: 107.4431 }; // ~41 km
    assert.deepEqual(pickNearestOpenOutlets([DAGO], LEMBANG).map((o) => o.id), ['dago']);
    assert.deepEqual(pickNearestOpenOutlets([DAGO], PURWAKARTA), []);
    assert.equal(noOutletReason([DAGO], PURWAKARTA), 'out_of_range');
    assert.equal(noOutletReason([{ ...DAGO, is_overcapacity: true }], PURWAKARTA), 'out_of_range');
    assert.equal(noOutletReason([{ ...DAGO, is_overcapacity: true }], HERE), 'full');
    assert.equal(noOutletReason([], PURWAKARTA), 'no_outlet');
    const km = nearestServingOutletKm([DAGO], PURWAKARTA);
    assert.ok(km != null && km > 30 && km < 50, String(km));
    assert.equal(nearestServingOutletKm([DAGO], null), null);
  });
  it('nearestOpenOutlet skips full outlets when another is open', () => {
    const far = { id: 'far', latitude: -6.95, longitude: 107.7 };
    const d = (a: number, b: number, c: number, e: number) => Math.hypot(a - c, b - e);
    assert.equal(nearestOpenOutlet([{ ...DAGO, is_overcapacity: true }, far], HERE, d)?.id, 'far');
  });
  it('only owner and supervisor may switch it', () => {
    assert.equal(canSetOutletCapacity('owner'), true);
    assert.equal(canSetOutletCapacity('Supervisor'), true);
    for (const r of ['kasir', 'cs', 'driver', 'admin_ops', 'head_management', '', null]) assert.equal(canSetOutletCapacity(r), false, String(r));
  });
});
