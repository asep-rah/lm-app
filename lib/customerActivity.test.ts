import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOngoingOrder, isScheduledOrder, localDateISO, localTimeHMS } from './customerActivity';

describe('localDateISO / localTimeHMS use local components, not UTC', () => {
  it('does not shift the date backward for early-morning WIB-style local times', () => {
    // 02:00 local time — a UTC-based toISOString().split('T')[0] would report
    // the PREVIOUS day whenever local time is ahead of UTC (e.g. WIB, UTC+7).
    const d = new Date(2026, 8, 24, 2, 0, 0); // 24 Sep 2026, 02:00 local (month is 0-indexed)
    assert.equal(localDateISO(d), '2026-09-24');
    assert.equal(localTimeHMS(d), '02:00:00');
  });

  it('pads single-digit month/day/hour/minute/second', () => {
    const d = new Date(2026, 0, 5, 3, 4, 5);
    assert.equal(localDateISO(d), '2026-01-05');
    assert.equal(localTimeHMS(d), '03:04:05');
  });
});

describe('"Jemput sekarang" with only pickup_date set stays classified as ongoing', () => {
  // Reproduces the fix for: null value in column "pickup_date" violates
  // not-null constraint. The payload now always sets pickup_date for instant
  // orders (today, local), WITHOUT pickup_time/scheduled_at/pickup_at, which
  // must not flip the order into "Terjadwal".
  const instantOrder = {
    status: 'Menunggu Kurir',
    pickup_date: localDateISO(),
    pickup_time: null,
    scheduled_at: null,
    pickup_at: null,
    notes: 'Alamat: Jl. Contoh No. 1 | Detail: Kiloan: Cuci 3Kg'
  };

  it('is NOT classified as a scheduled order', () => {
    assert.equal(isScheduledOrder(instantOrder), false);
  });

  it('is classified as ongoing (shows under "Berlangsung")', () => {
    assert.equal(isOngoingOrder(instantOrder), true);
  });

  it('a genuinely scheduled order (future pickup_at) is still classified as scheduled', () => {
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    const scheduled = { status: 'Terjadwal', pickup_date: localDateISO(), pickup_time: '10:00:00', pickup_at: future };
    assert.equal(isScheduledOrder(scheduled), true);
    assert.equal(isOngoingOrder(scheduled), false);
  });
});
