import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isValidSatuanPhotoPath,
  newSatuanPhotoPath,
  photoBelongsToOrder,
  photoPathsOfPickupItems,
  satuanPhotoOwnerFolder,
  staffMayViewOrderPhoto
} from './satuanPhotoAccess';

const SECRET = 'x'.repeat(40);
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const UUID2 = '223e4567-e89b-42d3-a456-426614174000';

describe('satuanPhotoOwnerFolder', () => {
  it('is stable across phone formats and does not contain the phone number', () => {
    const a = satuanPhotoOwnerFolder('081234567890', SECRET);
    assert.equal(a, satuanPhotoOwnerFolder('+6281234567890', SECRET));
    assert.equal(a, satuanPhotoOwnerFolder('6281234567890', SECRET));
    assert.match(a, /^[a-f0-9]{32}$/);
    assert.doesNotMatch(a, /1234567890/);
  });
  it('differs per customer and per secret; empty without secret/phone', () => {
    assert.notEqual(satuanPhotoOwnerFolder('081234567890', SECRET), satuanPhotoOwnerFolder('081299999999', SECRET));
    assert.notEqual(satuanPhotoOwnerFolder('081234567890', SECRET), satuanPhotoOwnerFolder('081234567890', 'y'.repeat(40)));
    assert.equal(satuanPhotoOwnerFolder('081234567890', ''), '');
    assert.equal(satuanPhotoOwnerFolder('', SECRET), '');
  });
});

describe('newSatuanPhotoPath / isValidSatuanPhotoPath', () => {
  it('builds folder/yyyy-mm/uuid.jpg and validates it', () => {
    const folder = satuanPhotoOwnerFolder('081234567890', SECRET);
    const path = newSatuanPhotoPath(folder, new Date(Date.UTC(2026, 8, 24)), UUID);
    assert.equal(path, `${folder}/2026-09/${UUID}.jpg`);
    assert.ok(isValidSatuanPhotoPath(path));
  });
  it('rejects traversal, other extensions and legacy/free-form paths', () => {
    const folder = satuanPhotoOwnerFolder('081234567890', SECRET);
    assert.equal(isValidSatuanPhotoPath(`../${folder}/2026-09/${UUID}.jpg`), false);
    assert.equal(isValidSatuanPhotoPath(`${folder}/2026-09/${UUID}.png`), false);
    assert.equal(isValidSatuanPhotoPath('satuan_0812_1_1700000000_abcd.jpg'), false);
    assert.equal(isValidSatuanPhotoPath(`${folder}/2026-09/${UUID}.jpg/../x`), false);
    assert.equal(isValidSatuanPhotoPath(123), false);
  });
});

describe('photoBelongsToOrder — a staff member can only open photos of that order', () => {
  const owner = '081234567890';
  const folder = satuanPhotoOwnerFolder(owner, SECRET);
  const path = `${folder}/2026-09/${UUID}.jpg`;
  const order = {
    customer_phone: owner,
    items: [{ name: 'Jas', pieces: [{ photo_path: path }] }, { name: 'Cuci Kering', type: 'kg' }]
  };

  it('accepts a photo listed on the order and stored in the order customer folder', () => {
    assert.ok(photoBelongsToOrder(path, order, SECRET));
    assert.ok(photoBelongsToOrder(path, { ...order, items: JSON.stringify(order.items) }, SECRET));
  });
  it('rejects a valid photo path that is not listed on the order', () => {
    const other = `${folder}/2026-09/${UUID2}.jpg`;
    assert.equal(photoBelongsToOrder(other, order, SECRET), false);
  });
  it('rejects an order that lists ANOTHER customer photo', () => {
    const victimFolder = satuanPhotoOwnerFolder('081299999999', SECRET);
    const victimPath = `${victimFolder}/2026-09/${UUID}.jpg`;
    const attackerOrder = { customer_phone: owner, items: [{ pieces: [{ photo_path: victimPath }] }] };
    assert.equal(photoBelongsToOrder(victimPath, attackerOrder, SECRET), false);
  });
  it('collects only valid photo paths from items', () => {
    const set = photoPathsOfPickupItems([{ pieces: [{ photo_path: path }, { photo_path: 'bad' }, {}] }, null, 'x']);
    assert.deepEqual([...set], [path]);
    assert.equal(photoPathsOfPickupItems('{not json').size, 0);
  });
});

describe('staffMayViewOrderPhoto — role & outlet checked from the DB row', () => {
  const order = { outlet_id: 'o1', items: [] };
  it('allows CS/owner/supervisor for any outlet', () => {
    for (const role of ['cs', 'cs_care', 'head_cs', 'owner', 'supervisor', 'admin_ops']) {
      assert.ok(staffMayViewOrderPhoto({ role, outlet_id: 'o9' }, order), role);
    }
  });
  it('limits kasir/pos to their own or assigned outlets', () => {
    assert.ok(staffMayViewOrderPhoto({ role: 'kasir', outlet_id: 'o1' }, order));
    assert.ok(staffMayViewOrderPhoto({ role: 'pos', outlet_id: 'o2', access_outlets: ['o1'] }, order));
    assert.ok(staffMayViewOrderPhoto({ role: 'kasir', outlet_id: 'o2', assigned_outlet_ids: '["o1"]' }, order));
    assert.equal(staffMayViewOrderPhoto({ role: 'kasir', outlet_id: 'o2' }, order), false);
    assert.equal(staffMayViewOrderPhoto({ role: 'kasir', outlet_id: 'o1' }, { outlet_id: null }), false);
  });
  it('denies driver, investor, unknown and empty roles', () => {
    for (const role of ['driver', 'investor', 'marketing', '', null]) {
      assert.equal(staffMayViewOrderPhoto({ role, outlet_id: 'o1' }, order), false, String(role));
    }
  });
});
