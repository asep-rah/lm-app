import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  profitShareReport,
  quarterBounds,
  quarterLabel,
  quarterMonths,
  quarterOf,
  recentQuarters,
  upcomingMeetings,
  type InvestorMeeting
} from './investorRelations';

describe('triwulan', () => {
  it('menentukan triwulan dari tanggal', () => {
    assert.equal(quarterOf('2026-01-15'), '2026-Q1');
    assert.equal(quarterOf('2026-09-20'), '2026-Q3');
    assert.equal(quarterOf('2026-12-31'), '2026-Q4');
  });

  it('tiga bulan per triwulan dengan month 0-based seperti PnlMonthRef', () => {
    assert.deepEqual(quarterMonths('2026-Q3'), [
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 }
    ]);
    assert.deepEqual(quarterMonths('2026-Q1')[0], { year: 2026, month: 0 });
  });

  it('batas tanggal triwulan tahu bulan pendek', () => {
    assert.deepEqual(quarterBounds('2026-Q1'), { start: '2026-01-01', end: '2026-03-31' });
    assert.deepEqual(quarterBounds('2026-Q2'), { start: '2026-04-01', end: '2026-06-30' });
  });

  it('triwulan tidak valid ditolak', () => {
    assert.deepEqual(quarterMonths('2026-Q5'), []);
    assert.equal(quarterBounds('bukan-triwulan'), null);
  });

  it('daftar triwulan terakhir melewati batas tahun', () => {
    assert.deepEqual(recentQuarters(3, new Date('2026-02-10T00:00:00Z')), [
      '2026-Q1',
      '2025-Q4',
      '2025-Q3'
    ]);
  });

  it('label triwulan dalam bahasa Indonesia', () => {
    assert.equal(quarterLabel('2026-Q3'), 'Jul–Sep 2026');
    assert.equal(quarterLabel(''), '—');
  });
});

describe('laporan bagi hasil', () => {
  const outletIds = ['o1', 'o2'];

  it('memakai persentase per outlet, jatuh ke default bila belum diatur', () => {
    const { lines, total } = profitShareReport({
      profit: 10_000_000,
      rates: { o1: 30 },
      defaultPct: 20,
      outletIds
    });
    assert.equal(lines[0].share, 3_000_000);
    assert.equal(lines[1].ratePct, 20);
    assert.equal(lines[1].share, 2_000_000);
    assert.equal(total, 5_000_000);
  });

  it('rugi tidak menghasilkan bagi hasil negatif', () => {
    const { lines, total } = profitShareReport({
      profit: -5_000_000,
      rates: {},
      defaultPct: 20,
      outletIds
    });
    assert.deepEqual(lines.map((l) => l.share), [0, 0]);
    assert.equal(total, 0);
  });
});

describe('jadwal meeting', () => {
  const meeting = (over: Partial<InvestorMeeting>): InvestorMeeting => ({
    id: Math.random().toString(36).slice(2),
    scheduled_at: '2026-10-01T03:00:00Z',
    quarter: '2026-Q4',
    agenda: null,
    location: null,
    attendees: [],
    report_id: null,
    minutes: null,
    status: 'scheduled',
    created_at: '2026-09-01T00:00:00Z',
    ...over
  });

  it('hanya menampilkan yang akan datang dan masih terjadwal', () => {
    const now = new Date('2026-09-20T00:00:00Z').getTime();
    const rows = upcomingMeetings(
      [
        meeting({ scheduled_at: '2026-09-01T00:00:00Z' }),
        meeting({ scheduled_at: '2026-11-01T00:00:00Z' }),
        meeting({ scheduled_at: '2026-10-01T00:00:00Z' }),
        meeting({ scheduled_at: '2026-10-15T00:00:00Z', status: 'cancelled' })
      ],
      now
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].scheduled_at, '2026-10-01T00:00:00Z');
  });
});
