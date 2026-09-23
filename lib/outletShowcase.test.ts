import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cityFromAddress, inferCustomerCity, nearbyActiveOutlets, outletCityOf, uniqueOutletCities } from './outletShowcase';

// Reproduksi kasus "Belum ada cabang resmi di Bandung" dengan bentuk data yang
// dihasilkan form Owner (city kosong disimpan sebagai '-').
const DAGO = {
  id: 'dago',
  name: 'Laundry Hari ini - Tubagus',
  city: '-',
  address_detail: 'Jl. Tubagus Ismail Raya No. 12, Dago, Coblong, Kota Bandung, Jawa Barat 40134',
  latitude: -6.8853,
  longitude: 107.6195,
  is_coming_soon: false
};
const JAKARTA = { id: 'jkt', name: 'Outlet Jakarta', city: 'Jakarta Selatan', latitude: -6.26, longitude: 106.81 };
const BANDUNG_SOON = { id: 'soon', name: 'Outlet Baru', city: 'Bandung', is_coming_soon: true };

describe('outlet city resolution', () => {
  it("treats '-' as missing and falls back to 'Kota X' in the address", () => {
    assert.equal(outletCityOf(DAGO), 'Kota Bandung');
    assert.equal(cityFromAddress('Jl. A No 1, Coblong, Bandung, Jawa Barat 40134'), 'Bandung');
    assert.equal(cityFromAddress('Jl. A No 1, Kab. Bandung Barat, Jawa Barat'), 'Kab. Bandung Barat');
  });

  it('city list contains Bandung once', () => {
    const cities = uniqueOutletCities([DAGO, JAKARTA, BANDUNG_SOON]);
    assert.equal(cities.filter((c) => /bandung/i.test(c)).length, 1);
  });
});

describe('Beranda → Outlet terdekat', () => {
  it('shows the Dago branch when city = Bandung (before the fix this list was empty)', () => {
    const rows = nearbyActiveOutlets([DAGO, JAKARTA, BANDUNG_SOON], { lat: -6.9, lon: 107.6 }, { city: 'Bandung' });
    assert.deepEqual(rows.map((r) => r.outlet.id), ['dago']);
  });

  it('keeps branches of the chosen city even if device GPS is far away (IP-based laptop location)', () => {
    const rows = nearbyActiveOutlets([DAGO, JAKARTA], { lat: -6.2, lon: 106.8 }, { city: 'Bandung' });
    assert.deepEqual(rows.map((r) => r.outlet.id), ['dago']);
  });

  it('keeps a city branch without coordinates, distance unknown', () => {
    const noPin = { ...DAGO, latitude: null, longitude: null };
    const rows = nearbyActiveOutlets([noPin], { lat: -6.9, lon: 107.6 }, { city: 'Bandung' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].km, null);
  });

  it('still uses the 25 km radius when no city is known, and never shows coming-soon outlets', () => {
    const rows = nearbyActiveOutlets([DAGO, JAKARTA, BANDUNG_SOON], { lat: -6.9, lon: 107.6 }, { ignoreCity: true });
    assert.deepEqual(rows.map((r) => r.outlet.id), ['dago']);
  });

  it('infers Bandung from the customer address and matches the real branch', () => {
    const city = inferCustomerCity([DAGO, JAKARTA], null, ['jl ir juanda dago no.378 bandung']);
    assert.match(city, /bandung/i);
    assert.equal(nearbyActiveOutlets([DAGO, JAKARTA], null, { city }).length, 1);
  });
});
