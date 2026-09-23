import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { customerPaymentOf, customerProgressOf, priceBreakdownOf, serviceSummaryOf } from './customerOrderView';

// Kasus nyata dari screenshot: item Cuci Kering Lipat Rp15.000, total akhir Rp1.000 karena diskon.
const TRX_152618 = {
  id: 'tx-1',
  receipt_number: 'TRX-152618',
  status: 'Sudah Dibayar',
  is_paid: true,
  payment_status: 'paid',
  amount: 1000,
  discount_type: 'nominal',
  discount_value: 14000,
  discount_amount: 14000,
  delivery_fee: 0,
  items: [{ name: 'Cuci Kering Lipat', type: 'kg', qty: 3, weight: 3, price: 5000 }]
};

describe('price breakdown matches POS receipt arithmetic', () => {
  it('Rp15.000 item with Rp14.000 discount → total Rp1.000 (not "fixed" to Rp15.000)', () => {
    const bd = priceBreakdownOf(TRX_152618);
    assert.equal(bd.isEstimate, false);
    assert.equal(bd.items[0].amount, 15000);
    assert.equal(bd.subtotal, 15000);
    assert.deepEqual(bd.discounts, [{ label: 'Diskon', amount: 14000 }]);
    assert.equal(bd.total, 1000);
    // Same formula POS receipt & finance recon use: gross = amount + discount_amount − delivery_fee
    assert.equal(bd.subtotal, TRX_152618.amount + TRX_152618.discount_amount - TRX_152618.delivery_fee);
    assert.equal(bd.subtotal - bd.discounts.reduce((s, d) => s + d.amount, 0) + bd.deliveryFee, bd.total);
  });

  it('splits percent discount and folded-in loyalty redemption exactly like POS computes it', () => {
    // POS: subtotal 50.000, diskon 10% = 5.000, poin 5.000 → discount_amount 10.000, ongkir 18.000
    const bd = priceBreakdownOf({
      receipt_number: 'TRX-2',
      amount: 58000,
      discount_type: 'percent',
      discount_value: 10,
      discount_amount: 10000,
      delivery_fee: 18000,
      items: []
    });
    assert.equal(bd.subtotal, 50000);
    assert.deepEqual(bd.discounts, [
      { label: 'Diskon 10%', amount: 5000 },
      { label: 'Potongan poin loyalty', amount: 5000 }
    ]);
    assert.equal(bd.deliveryFee, 18000);
    assert.equal(bd.total, 58000);
  });

  it('pickup request shows the form estimate, promo and loyalty from notes', () => {
    const bd = priceBreakdownOf({
      order_number: 'ORD-1',
      delivery_fee: 0,
      notes: 'Alamat: x | Detail: Kiloan: Cuci 3Kg | Promo: HEMAT5 | Poin loyalty: -Rp 5.000 | Est. Tagihan: Rp 11.000',
      items: [{ name: 'Cuci Kering Lipat', type: 'kg', qty: 1, weight: 3, price: 7000 }]
    });
    assert.equal(bd.isEstimate, true);
    assert.equal(bd.subtotal, 21000);
    assert.deepEqual(bd.discounts, [
      { label: 'Promo HEMAT5', amount: 5000 },
      { label: 'Potongan poin loyalty', amount: 5000 }
    ]);
    assert.equal(bd.total, 11000);
  });
});

describe('progress vs payment are separate', () => {
  it('"Sudah Dibayar" is payment, progress continues to Sortir', () => {
    assert.deepEqual(customerPaymentOf(TRX_152618), { tone: 'paid', label: 'Lunas' });
    const p = customerProgressOf(TRX_152618, []);
    assert.equal(p.key, 'sortir');
    assert.equal(p.label, 'Sedang disortir');
  });

  it('work logs advance the progress', () => {
    const p = customerProgressOf(TRX_152618, [
      { stage: 'Sortir', created_at: '2026-09-12T10:00:00Z' },
      { stage: 'Cuci', created_at: '2026-09-12T11:00:00Z' }
    ]);
    assert.equal(p.key, 'kering');
  });

  it('pickup request not yet billed shows estimate badge and pickup progress', () => {
    const order = { order_number: 'ORD-9', status: 'Menunggu Kurir' };
    assert.equal(customerPaymentOf(order).tone, 'estimate');
    assert.equal(customerProgressOf(order).key, 'jemput');
    assert.equal(customerProgressOf({ order_number: 'ORD-9', status: 'Driver Menuju Lokasi' }).label, 'Driver menuju lokasi');
  });

  it('unpaid QRIS transaction waits for payment without faking progress as paid', () => {
    const tx = { receipt_number: 'TRX-3', status: 'Menunggu Pembayaran', payment_status: 'pending', payment_method: 'QRIS' };
    assert.equal(customerPaymentOf(tx).tone, 'pending');
  });

  it('cancelled order', () => {
    assert.equal(customerProgressOf({ receipt_number: 'X', status: 'Batal' }).key, 'batal');
  });
});

describe('service summary', () => {
  it('uses items first', () => {
    assert.equal(serviceSummaryOf(TRX_152618), 'Cuci Kering Lipat 3 Kg');
    assert.equal(
      serviceSummaryOf({ items: [{ name: 'A', type: 'pcs', qty: 2 }, { name: 'B' }] }),
      'A ×2 + 1 item'
    );
    assert.equal(serviceSummaryOf({ service_type: 'Laundry Kiloan (Reguler)' }), 'Laundry Kiloan (Reguler)');
  });
});
