import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressDisplayLabel } from './customerAddressLabels';

const rows = [
  { id: 'a', label: 'Lainnya', full_address: 'Hotel sheraton bandung' },
  { id: 'b', label: 'Rumah', full_address: 'jl ir juanda dago no.378 bandung' },
  { id: 'c', label: 'Rumah', full_address: 'Jl supriyadi semarang' }
];

describe('saved address labels (display only)', () => {
  it('unique labels stay as-is', () => {
    assert.equal(addressDisplayLabel(rows[0], rows), 'Lainnya');
  });

  it('duplicate "Rumah" labels get a street hint', () => {
    assert.equal(addressDisplayLabel(rows[1], rows), 'Rumah · Jl Ir Juanda Dago Ban…');
    assert.equal(addressDisplayLabel(rows[2], rows), 'Rumah · Jl Supriyadi Semarang');
  });

  it('identical hints get an ordinal and the stored data is untouched', () => {
    const same = [
      { id: 'x', label: 'Rumah', full_address: 'Jl Mawar 1' },
      { id: 'y', label: 'Rumah', full_address: 'Jl Mawar 1' }
    ];
    assert.equal(addressDisplayLabel(same[0], same), 'Rumah · Jl Mawar 1 #1');
    assert.equal(addressDisplayLabel(same[1], same), 'Rumah · Jl Mawar 1 #2');
    assert.equal(same[0].label, 'Rumah');
  });
});
