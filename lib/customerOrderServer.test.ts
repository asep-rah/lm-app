import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jakartaDate, orderPhone08, validateCustomerOrder, type CustomerOrderContext } from './customerOrderServer';

const FOLDER = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const photo = (folder = FOLDER, n = 1) => `${folder}/2026-09/123e4567-e89b-42d3-a456-${String(n).padStart(12, '0')}.jpg`;
const ctx = (over: Partial<CustomerOrderContext> = {}): CustomerOrderContext => ({
  sessionPhone: '081234567890',
  legacyAllowed: false,
  photoRequired: true,
  ownerFolder: FOLDER,
  today: '2026-09-24',
  ...over
});
const base = (over: Record<string, unknown> = {}) => ({
  order_number: 'ORD-12345678-1234',
  outlet_id: 'e5e50000-0000-4000-8000-00000000000a',
  customer_name: 'Uji',
  customer_phone: '081234567890',
  address: 'Jl. Uji No. 1',
  items: [{ name: 'Cuci Kering', type: 'kg', qty: 1, weight: 3, price: 15000, bag_category_counts: { bajuRingan: '5' } }],
  status: 'Selesai',
  pickup_date: '2020-01-01',
  courier_type: 'THIRD_PARTY',
  ...over
});
const pcs = (pieces: unknown[], qty = pieces.length) => ({ name: 'Jas', type: 'pcs', qty, price: 30000, pieces });

describe('validateCustomerOrder', () => {
  it('instant order: server decides status/date, keeps courier type, normalises counts', () => {
    const r = validateCustomerOrder(base(), ctx());
    assert.ok(r.ok);
    const row = r.order.row;
    assert.equal(row.status, 'Menunggu Kurir', 'client status "Selesai" is ignored');
    assert.equal(row.pickup_date, '2026-09-24', 'client date ignored for instant orders');
    assert.equal(row.pickup_time, null);
    assert.equal(row.courier_type, 'THIRD_PARTY');
    assert.deepEqual((row.items as Array<Record<string, unknown>>)[0].bag_category_counts, { bajuRingan: 5 });
    assert.equal(r.order.scheduled, false);
  });
  it('scheduled order: status Terjadwal, date/time from the body, Jakarta time', () => {
    const r = validateCustomerOrder(base({ pickup_date: '2026-09-25', pickup_time: '09:30' }), ctx());
    assert.ok(r.ok);
    assert.deepEqual(
      [r.order.row.status, r.order.row.pickup_date, r.order.row.pickup_time, r.order.row.scheduled_at, r.order.row.courier_type],
      ['Terjadwal', '2026-09-25', '09:30:00', '2026-09-25T02:30:00.000Z', null]
    );
    assert.equal(validateCustomerOrder(base({ pickup_date: '2026-09-23', pickup_time: '09:30' }), ctx()).ok, false, 'past');
    assert.equal(validateCustomerOrder(base({ pickup_date: '2027-09-23', pickup_time: '09:30' }), ctx()).ok, false, 'too far');
  });
  it('phone comes from the session; a different body phone is refused', () => {
    const r = validateCustomerOrder(base({ customer_phone: '6281234567890' }), ctx());
    assert.ok(r.ok);
    assert.equal(r.order.row.customer_phone, '081234567890');
    const other = validateCustomerOrder(base({ customer_phone: '089999999999' }), ctx());
    assert.deepEqual(other.ok ? null : other.status, 403);
  });
  it('without a session: only while legacy login is on, and never for satuan items with the photo feature on', () => {
    assert.equal((validateCustomerOrder(base(), ctx({ sessionPhone: null, ownerFolder: '' })) as { status: number }).status, 401);
    assert.ok(validateCustomerOrder(base(), ctx({ sessionPhone: null, ownerFolder: '', legacyAllowed: true })).ok);
    const withPcs = validateCustomerOrder(base({ items: [pcs([{ photo_path: photo() }])] }), ctx({ sessionPhone: null, ownerFolder: '', legacyAllowed: true }));
    assert.equal((withPcs as { status: number }).status, 401);
  });
  it('photo feature on: every satuan piece needs a photo from the own folder', () => {
    assert.ok(validateCustomerOrder(base({ items: [pcs([{ photo_path: photo(FOLDER, 1) }, { photo_path: photo(FOLDER, 2) }])] }), ctx()).ok);
    const missing = validateCustomerOrder(base({ items: [pcs([{ photo_path: photo() }, { merk: 'x' }])] }), ctx());
    assert.equal((missing as { status: number }).status, 400);
    const foreign = validateCustomerOrder(base({ items: [pcs([{ photo_path: photo(OTHER) }])] }), ctx());
    assert.equal((foreign as { status: number }).status, 400);
    const url = validateCustomerOrder(base({ items: [pcs([{ photo_path: `https://x.test/${photo()}` }])] }), ctx());
    assert.equal((url as { status: number }).status, 400);
    const fewer = validateCustomerOrder(base({ items: [pcs([{ photo_path: photo() }], 2)] }), ctx());
    assert.equal((fewer as { status: number }).status, 400, 'qty 2 needs 2 pieces');
  });
  it('identical pieces may share one photo; paths are deduplicated for the existence check', () => {
    const r = validateCustomerOrder(base({ items: [pcs([{ photo_path: photo() }, { photo_path: photo() }])] }), ctx());
    assert.ok(r.ok);
    assert.deepEqual(r.order.photoPaths, [photo()]);
  });
  it('photo feature off: photo paths are dropped, no session needed with legacy login', () => {
    const r = validateCustomerOrder(base({ items: [pcs([{ merk: 'A', photo_path: photo(OTHER) }])] }), ctx({ photoRequired: false, sessionPhone: null, ownerFolder: '', legacyAllowed: true }));
    assert.ok(r.ok);
    assert.deepEqual((r.order.row.items as Array<{ pieces: unknown[] }>)[0].pieces, [{ merk: 'A', warna: '', corak: '' }]);
    assert.deepEqual(r.order.photoPaths, []);
  });
  it('rejects unknown item types, missing outlet/address/items and drops unknown fields', () => {
    assert.equal(validateCustomerOrder(base({ items: [{ name: 'x', type: 'free' }] }), ctx()).ok, false);
    assert.equal(validateCustomerOrder(base({ outlet_id: 'dago' }), ctx()).ok, false);
    assert.equal(validateCustomerOrder(base({ address: ' ' }), ctx()).ok, false);
    assert.equal(validateCustomerOrder(base({ items: [] }), ctx()).ok, false);
    const r = validateCustomerOrder(base({ is_paid: true, driver_id: 'x', transaction_id: 'y' }), ctx());
    assert.ok(r.ok);
    for (const k of ['is_paid', 'driver_id', 'transaction_id']) assert.ok(!(k in r.order.row), k);
  });
  it('foreign customer (verified session +65…) can order; phone stored as +65…', () => {
    const r = validateCustomerOrder(base({ customer_phone: '+65 9123 4567' }), ctx({ sessionPhone: '+6591234567' }));
    assert.ok(r.ok);
    assert.equal(r.order.row.customer_phone, '+6591234567');
    assert.equal(r.order.row.phone_number, '+6591234567');
    // Another number than the session is still refused.
    assert.equal((validateCustomerOrder(base({ customer_phone: '+6598765432' }), ctx({ sessionPhone: '+6591234567' })) as { status: number }).status, 403);
  });
  it('helpers', () => {
    assert.equal(orderPhone08('+62 812-3456-7890'), '081234567890');
    assert.equal(orderPhone08('12345'), '');
    assert.equal(orderPhone08('+65 9123 4567'), '+6591234567');
    assert.equal(orderPhone08('+81 90 1234 5678'), '+819012345678');
    assert.equal(orderPhone08('0221234567'), ''); // Indonesian landline is not WhatsApp
    assert.equal(jakartaDate(new Date('2026-09-24T18:30:00Z')), '2026-09-25');
  });
});
