import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SERVICE_RADIUS_KM,
  checkPickupServiceArea,
  distanceKm,
  formatMeters,
  gpsAccuracyLevel,
  isWithinServiceRadius,
  toLatLon
} from './serviceArea';
import { checkPinCorrection, canCorrectPickupPin } from './pickupPinCorrection';

const DAGO = { lat: -6.8853, lon: 107.6195 };
const OUTLET = { latitude: DAGO.lat, longitude: DAGO.lon, is_overcapacity: false, is_coming_soon: false };
const NEAR = { latitude: -6.886, longitude: 107.613 }; // < 1 km
const LEMBANG = { latitude: -6.8117, longitude: 107.6175 }; // ~8 km
const PURWAKARTA = { latitude: -6.5569, longitude: 107.4431 }; // ~41 km
const SEMARANG = { latitude: -6.99, longitude: 110.42 };

describe('service radius (30 km, straight line)', () => {
  it('is 30 km', () => assert.equal(SERVICE_RADIUS_KM, 30));
  it('distance and radius', () => {
    assert.ok(distanceKm(DAGO, { lat: -6.8117, lon: 107.6175 }) < 10);
    assert.equal(isWithinServiceRadius(DAGO, toLatLon(PURWAKARTA.latitude, PURWAKARTA.longitude)!), false);
    assert.equal(isWithinServiceRadius(DAGO, toLatLon(LEMBANG.latitude, LEMBANG.longitude)!), true);
  });
  it('toLatLon rejects missing / 0,0 / out of range', () => {
    for (const [a, b] of [[null, 1], ['', ''], [0, 0], [91, 1], [1, 181], ['x', 1]] as const) assert.equal(toLatLon(a, b), null);
    assert.deepEqual(toLatLon('-6.8', '107.6'), { lat: -6.8, lon: 107.6 });
  });
});

describe('checkPickupServiceArea (order create)', () => {
  it('accepts a pin in range', () => assert.deepEqual(checkPickupServiceArea(NEAR, OUTLET), { ok: true }));
  it('rejects out of range, missing pin, full, coming soon, unknown outlet', () => {
    const far = checkPickupServiceArea(PURWAKARTA, OUTLET);
    assert.equal(far.ok, false);
    assert.match((far as { error: string }).error, /di luar jangkauan.*maksimal 30 km/);
    assert.equal((checkPickupServiceArea(SEMARANG, OUTLET) as { status: number }).status, 400);
    assert.equal((checkPickupServiceArea({}, OUTLET) as { status: number }).status, 400);
    assert.equal((checkPickupServiceArea({ latitude: 0, longitude: 0 }, OUTLET) as { status: number }).status, 400);
    assert.equal((checkPickupServiceArea(NEAR, { ...OUTLET, is_overcapacity: true }) as { status: number }).status, 409);
    assert.equal((checkPickupServiceArea(NEAR, { ...OUTLET, is_coming_soon: true }) as { status: number }).status, 400);
    assert.equal(checkPickupServiceArea(NEAR, null).ok, false);
  });
  it('an outlet without a location cannot be distance-checked and is accepted', () => {
    assert.deepEqual(checkPickupServiceArea(SEMARANG, { latitude: null, longitude: null }), { ok: true });
  });
});

describe('GPS accuracy', () => {
  it('levels', () => {
    assert.equal(gpsAccuracyLevel(12), 'good');
    assert.equal(gpsAccuracyLevel(50), 'good');
    assert.equal(gpsAccuracyLevel(51), 'poor');
    assert.equal(gpsAccuracyLevel(null), 'unknown');
    assert.equal(gpsAccuracyLevel(undefined), 'unknown');
    assert.equal(gpsAccuracyLevel(NaN), 'unknown');
  });
  it('formatMeters', () => {
    assert.equal(formatMeters(12.4), '±12 m');
    assert.equal(formatMeters(1250), '±1,3 km');
  });
});

describe('driver pin correction', () => {
  const order = { status: 'Driver Menuju Lokasi', driver_name: 'Budi Santoso' };
  const ok = { order, driverName: 'budi  santoso', lat: NEAR.latitude, lon: NEAR.longitude, accuracyM: 8, outlet: OUTLET };
  it('assigned driver on the way, accurate GPS in range → ok', () => {
    const r = checkPinCorrection(ok);
    assert.equal(r.ok, true);
    assert.deepEqual((r as { point: unknown }).point, { lat: NEAR.latitude, lon: NEAR.longitude });
    assert.equal(canCorrectPickupPin(order, 'Budi Santoso'), true);
  });
  it('other driver → 404; wrong status → 409', () => {
    assert.equal((checkPinCorrection({ ...ok, driverName: 'Andi' }) as { status: number }).status, 404);
    assert.equal((checkPinCorrection({ ...ok, order: null }) as { status: number }).status, 404);
    for (const status of ['Barang Dibawa ke Outlet', 'Menunggu Kurir', 'Selesai', 'Driver Mengantar']) {
      assert.equal((checkPinCorrection({ ...ok, order: { ...order, status } }) as { status: number }).status, 409, status);
      assert.equal(canCorrectPickupPin({ ...order, status }, 'Budi Santoso'), false);
    }
  });
  it('bad GPS / inaccurate / out of range → 400', () => {
    for (const bad of [
      { lat: null, lon: null },
      { lat: 0, lon: 0 },
      { accuracyM: 51 },
      { accuracyM: undefined },
      { accuracyM: -1 },
      { lat: PURWAKARTA.latitude, lon: PURWAKARTA.longitude }
    ]) {
      assert.equal((checkPinCorrection({ ...ok, ...bad }) as { status: number }).status, 400, JSON.stringify(bad));
    }
  });
});
