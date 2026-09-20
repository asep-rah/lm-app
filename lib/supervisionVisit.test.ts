import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECKLIST_ITEMS,
  daysSince,
  failingItems,
  isVisitSubmitted,
  scoreTone,
  visitScore,
  type Checklist
} from './supervisionVisit';

describe('skor kunjungan', () => {
  it('semua baik = 100', () => {
    const c = Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.key, 'ok'])) as Checklist;
    assert.equal(visitScore(c), 100);
  });

  it('semua buruk = 0', () => {
    const c = Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.key, 'buruk'])) as Checklist;
    assert.equal(visitScore(c), 0);
  });

  it('perlu perbaikan dihitung setengah', () => {
    assert.equal(visitScore({ kebersihan: 'ok', mesin: 'perlu_perbaikan' } as Checklist), 75);
  });

  it('poin yang dilewati tidak dihitung sebagai nol', () => {
    // Hanya satu poin dinilai dan hasilnya baik -> 100, bukan 1/6.
    assert.equal(visitScore({ kebersihan: 'ok' } as Checklist), 100);
  });

  it('belum ada penilaian = null, bukan 0', () => {
    assert.equal(visitScore({}), null);
    assert.equal(visitScore(null), null);
  });

  it('nilai checklist tak dikenal diabaikan', () => {
    assert.equal(visitScore({ kebersihan: 'ok', mesin: 'entah' } as unknown as Checklist), 100);
  });
});

describe('warna skor', () => {
  it('memetakan ambang batas', () => {
    assert.equal(scoreTone(90), 'emerald');
    assert.equal(scoreTone(80), 'emerald');
    assert.equal(scoreTone(79), 'amber');
    assert.equal(scoreTone(60), 'amber');
    assert.equal(scoreTone(59), 'rose');
    assert.equal(scoreTone(null), 'slate');
  });
});

describe('poin bermasalah', () => {
  it('hanya mengambil yang perlu perbaikan atau buruk', () => {
    const hasil = failingItems({
      kebersihan: 'ok',
      mesin: 'buruk',
      stok: 'perlu_perbaikan'
    } as Checklist).map((i) => i.key);
    assert.deepEqual(hasil, ['mesin', 'stok']);
  });

  it('checklist kosong tidak menghasilkan temuan', () => {
    assert.deepEqual(failingItems({}), []);
  });
});

describe('status & jarak kunjungan', () => {
  it('draft belum terkirim', () => {
    assert.equal(isVisitSubmitted({ status: 'draft' }), false);
    assert.equal(isVisitSubmitted({ status: 'submitted' }), true);
    assert.equal(isVisitSubmitted({ status: 'reviewed' }), true);
  });

  it('menghitung hari sejak kunjungan', () => {
    const now = new Date('2026-09-20T00:00:00Z').getTime();
    assert.equal(daysSince('2026-09-13', now), 7);
    assert.equal(daysSince(null, now), null);
    assert.equal(daysSince('bukan tanggal', now), null);
  });
});
