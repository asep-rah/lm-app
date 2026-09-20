import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MARKETING_STATUS,
  canTransition,
  googleStatusByOutlet,
  isMarketingOpen,
  marketingTypeLabel,
  nextStatuses,
  outletsNeedingAttention,
  type GoogleSnapshot
} from './marketingRequest';

describe('alur pengajuan marketing', () => {
  it('transisi yang sah dari status masuk', () => {
    assert.deepEqual(nextStatuses(MARKETING_STATUS.SUBMITTED), [
      MARKETING_STATUS.IN_PROGRESS,
      MARKETING_STATUS.REJECTED
    ]);
  });

  it('tidak boleh melompat dari masuk langsung ke selesai', () => {
    assert.equal(canTransition(MARKETING_STATUS.SUBMITTED, MARKETING_STATUS.DONE), false);
    assert.equal(canTransition(MARKETING_STATUS.IN_PROGRESS, MARKETING_STATUS.DONE), true);
  });

  it('menunggu persetujuan boleh kembali dikerjakan untuk revisi', () => {
    assert.equal(
      canTransition(MARKETING_STATUS.WAITING_APPROVAL, MARKETING_STATUS.IN_PROGRESS),
      true
    );
  });

  it('status akhir tidak punya lanjutan', () => {
    assert.deepEqual(nextStatuses(MARKETING_STATUS.DONE), []);
    assert.deepEqual(nextStatuses(MARKETING_STATUS.REJECTED), []);
  });

  it('status tak dikenal tidak membuka transisi apa pun', () => {
    assert.deepEqual(nextStatuses('entah'), []);
    assert.equal(canTransition('entah', MARKETING_STATUS.DONE), false);
  });

  it('pengajuan terbuka vs tertutup', () => {
    assert.equal(isMarketingOpen({ status: MARKETING_STATUS.IN_PROGRESS }), true);
    assert.equal(isMarketingOpen({ status: MARKETING_STATUS.DONE }), false);
    assert.equal(isMarketingOpen({ status: MARKETING_STATUS.REJECTED }), false);
  });

  it('label jenis pengajuan', () => {
    assert.equal(marketingTypeLabel('google_ads'), 'Google Ads');
    assert.equal(marketingTypeLabel('entah'), 'entah');
  });
});

describe('pemantauan Google Bisnis', () => {
  const snap = (over: Partial<GoogleSnapshot>): GoogleSnapshot => ({
    id: Math.random().toString(36).slice(2),
    outlet_id: 'o1',
    captured_at: '2026-09-20T00:00:00Z',
    rating: 4.8,
    review_count: 120,
    new_reviews: [],
    unreplied_count: 0,
    snapshot_date: '2026-09-20',
    ...over
  });

  it('mengambil kondisi terbaru dan selisih rating terhadap snapshot terlama', () => {
    const rows = googleStatusByOutlet([
      snap({ captured_at: '2026-09-01T00:00:00Z', rating: 4.9 }),
      snap({ captured_at: '2026-09-20T00:00:00Z', rating: 4.6, review_count: 130 })
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rating, 4.6);
    assert.equal(rows[0].reviewCount, 130);
    assert.equal(rows[0].ratingDelta, -0.3);
  });

  it('satu snapshot tidak menghasilkan selisih palsu', () => {
    const rows = googleStatusByOutlet([snap({})]);
    assert.equal(rows[0].ratingDelta, null);
  });

  it('menyoroti rating turun dan review belum dibalas', () => {
    const statuses = googleStatusByOutlet([
      snap({ outlet_id: 'turun', captured_at: '2026-09-01T00:00:00Z', rating: 4.9 }),
      snap({ outlet_id: 'turun', captured_at: '2026-09-20T00:00:00Z', rating: 4.5 }),
      snap({ outlet_id: 'aman', captured_at: '2026-09-01T00:00:00Z', rating: 4.9 }),
      snap({ outlet_id: 'aman', captured_at: '2026-09-20T00:00:00Z', rating: 4.9 }),
      snap({ outlet_id: 'belum_dibalas', unreplied_count: 3 })
    ]);
    const attention = outletsNeedingAttention(statuses);
    const ids = attention.map((a) => a.outletId);
    assert.ok(ids.includes('turun'));
    assert.ok(ids.includes('belum_dibalas'));
    assert.equal(ids.includes('aman'), false);
    // Penurunan terbesar muncul lebih dulu.
    assert.equal(attention[0].outletId, 'turun');
  });

  it('rating kosong tidak dianggap penurunan', () => {
    const statuses = googleStatusByOutlet([
      snap({ outlet_id: 'x', captured_at: '2026-09-01T00:00:00Z', rating: null }),
      snap({ outlet_id: 'x', captured_at: '2026-09-20T00:00:00Z', rating: null })
    ]);
    assert.equal(statuses[0].ratingDelta, null);
    assert.equal(outletsNeedingAttention(statuses).length, 0);
  });
});
