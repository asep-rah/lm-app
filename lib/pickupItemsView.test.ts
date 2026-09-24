import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickupItemsViewOf } from './pickupItemsView';

describe('pickupItemsViewOf — what POS/CS see for an online order', () => {
  it('summarises separated bags with pcs, est. kg, service and duration', () => {
    const items = [
      {
        name: 'Cuci Kering',
        type: 'kg',
        weight: 1.93,
        duration: 'Reguler (3 Hari)',
        bag_category_counts: { bajuRingan: '2', celanaBiasa: '1', celanaJeans: '1', cd: '3', bra: '1' }
      },
      { name: 'Cuci Setrika', type: 'kg', weight: 1.2, duration: 'Kilat', bag_category_counts: { bajuRingan: '6' } },
      { name: 'Jas', qty: 2, duration: 'Reguler', pieces: [{ photo_path: 'p1' }, {}] }
    ];
    const v = pickupItemsViewOf(JSON.stringify(items));
    assert.equal(v.kiloan.length, 2);
    assert.deepEqual(
      { name: v.kiloan[0].name, duration: v.kiloan[0].duration, pcs: v.kiloan[0].pcs, estKg: v.kiloan[0].estKg },
      { name: 'Cuci Kering', duration: 'Reguler (3 Hari)', pcs: 8, estKg: 1.93 }
    );
    assert.equal(v.kiloan[0].counts?.cd, 3);
    assert.equal(v.kiloan[1].pcs, 6);
    assert.equal(v.kiloan[1].counts?.bra, 0);
    assert.deepEqual(v.satuan, [{ name: 'Jas', qty: 2, duration: 'Reguler', photoPaths: ['p1', null] }]);
  });
  it('handles legacy kiloan lines without category detail and bad input', () => {
    const v = pickupItemsViewOf([{ name: 'Cuci Kering', type: 'kg', weight: 3 }]);
    assert.deepEqual(v.kiloan, [{ name: 'Cuci Kering', duration: '', estKg: 3, pcs: null, counts: null }]);
    assert.deepEqual(pickupItemsViewOf('not json'), { kiloan: [], satuan: [] });
    assert.deepEqual(pickupItemsViewOf(null), { kiloan: [], satuan: [] });
  });
});
