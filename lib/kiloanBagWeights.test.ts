import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bagCategoryCountsComplete,
  bagCategoryCountsValid,
  DEFAULT_BAG_CATEGORY_WEIGHTS_G,
  emptyBagCategoryCounts,
  kiloanOrderKgOf,
  KILOAN_MIN_ORDER_KG,
  summarizeBagWeight
} from './kiloanBagWeights';

describe('bagCategoryCountsComplete — wajib diisi, 0 boleh', () => {
  it('empty strings are incomplete', () => {
    assert.equal(bagCategoryCountsComplete(emptyBagCategoryCounts()), false);
  });

  it('all zeros is complete (0 is a valid explicit answer)', () => {
    assert.equal(
      bagCategoryCountsComplete({ bajuRingan: '0', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' }),
      true
    );
  });

  it('a single missing field is still incomplete', () => {
    assert.equal(
      bagCategoryCountsComplete({ bajuRingan: '2', celanaBiasa: '', celanaJeans: '0', cd: '0', bra: '0' }),
      false
    );
  });

  it('rejects negative or non-integer input', () => {
    assert.equal(
      bagCategoryCountsComplete({ bajuRingan: '-1', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' }),
      false
    );
    assert.equal(
      bagCategoryCountsComplete({ bajuRingan: '1.5', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' }),
      false
    );
  });
});

describe('summarizeBagWeight — pcs & kg dihitung otomatis dari isian × berat acuan', () => {
  it('example from the spec: default reference weights', () => {
    // 2 baju ringan, 1 celana biasa, 1 celana jeans, 3 CD, 1 bra
    const counts = { bajuRingan: '2', celanaBiasa: '1', celanaJeans: '1', cd: '3', bra: '1' };
    const { pcs, gram, kg } = summarizeBagWeight(counts);
    assert.equal(pcs, 8);
    assert.equal(gram, 2 * 200 + 1 * 500 + 1 * 700 + 3 * 75 + 1 * 100);
    assert.equal(gram, 1925);
    assert.equal(kg, 1.93); // rounded to 2 decimals
  });

  it('all zeros yields zero weight', () => {
    assert.deepEqual(summarizeBagWeight({ bajuRingan: '0', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' }), {
      pcs: 0,
      gram: 0,
      kg: 0
    });
  });

  it('reference weights are configurable, not hardcoded per call', () => {
    const customWeights = { ...DEFAULT_BAG_CATEGORY_WEIGHTS_G, bajuRingan: 300 };
    const { gram } = summarizeBagWeight({ bajuRingan: '1', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' }, customWeights);
    assert.equal(gram, 300);
  });

  it('empty/invalid entries count as 0, never NaN', () => {
    const { pcs, gram, kg } = summarizeBagWeight({ bajuRingan: '', celanaBiasa: 'abc', celanaJeans: '2', cd: '0', bra: '0' });
    assert.equal(pcs, 2);
    assert.equal(gram, 1400);
    assert.equal(kg, 1.4);
    assert.ok(Number.isFinite(kg));
  });
});

describe('bagCategoryCountsValid — total per kantong harus > 0, tapi TIDAK dipaksa ≥ 3kg', () => {
  it('rejects all-zero (total must be > 0)', () => {
    assert.equal(bagCategoryCountsValid({ bajuRingan: '0', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' }), false);
  });

  it('accepts a small bag well under 3kg — per-bag minimum is not enforced', () => {
    const oneShirt = { bajuRingan: '1', celanaBiasa: '0', celanaJeans: '0', cd: '0', bra: '0' };
    assert.equal(bagCategoryCountsValid(oneShirt), true);
    assert.ok(summarizeBagWeight(oneShirt).kg < KILOAN_MIN_ORDER_KG);
  });

  it('rejects incomplete input even if some categories are non-zero', () => {
    assert.equal(bagCategoryCountsValid({ bajuRingan: '5', celanaBiasa: '', celanaJeans: '0', cd: '0', bra: '0' }), false);
  });
});

describe('kiloanOrderKgOf — minimum 3kg berlaku di level ORDER (jumlah semua kantong)', () => {
  it('sums kg across multiple bag lines, each individually under the minimum', () => {
    const lines = [{ kg: 1.2 }, { kg: 2.1 }];
    const total = kiloanOrderKgOf(lines);
    assert.equal(total, 3.3);
    assert.ok(total >= KILOAN_MIN_ORDER_KG);
    // Neither individual bag reaches the minimum on its own — that's expected.
    assert.ok(lines.every((l) => (l.kg || 0) < KILOAN_MIN_ORDER_KG));
  });

  it('handles a single combined line the same as before (no bag split)', () => {
    assert.equal(kiloanOrderKgOf([{ kg: 3 }]), 3);
  });

  it('empty lines sum to 0', () => {
    assert.equal(kiloanOrderKgOf([]), 0);
  });
});
