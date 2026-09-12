import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectionAssetBucket,
  collectionDateIso,
  financePayKind,
  isFinanceMarkedPaid,
  isFinanceSettledToBank,
  missingPaidAtWhilePaid,
  saleAssetBucket,
  unpaidSalesTotal
} from './financeRecognition';

describe('is_paid vs payment_status vs settled', () => {
  const pending = {
    amount: 4000,
    is_paid: false,
    payment_status: 'pending',
    payment_method: 'QRIS',
    status: 'menunggu_pembayaran'
  };
  const paidGateway = {
    amount: 4000,
    is_paid: true,
    payment_status: 'paid',
    payment_method: 'QRIS',
    paid_via: 'GATEWAY',
    paid_at: '2026-09-05T12:00:00.000Z'
  };
  const paidManual = {
    ...paidGateway,
    paid_via: 'MANUAL_VERIFIED'
  };
  const cash = {
    amount: 11000,
    is_paid: true,
    payment_status: 'paid',
    payment_method: 'Cash'
  };

  it('maps buckets correctly', () => {
    assert.equal(saleAssetBucket(pending), 'receivable');
    assert.equal(saleAssetBucket(cash), 'bank');
    assert.equal(isFinanceMarkedPaid(paidGateway), true);
    assert.equal(isFinanceSettledToBank(paidGateway), false);
    assert.equal(collectionAssetBucket(paidGateway), 'clearing');
    assert.equal(collectionAssetBucket(paidManual), 'bank');
    assert.equal(financePayKind(pending), 'receivable');
    assert.equal(financePayKind(paidGateway), 'clearing');
    assert.equal(financePayKind(paidManual), 'cash');
  });

  it('requires paid_at for dated collection', () => {
    assert.equal(collectionDateIso(pending), null);
    assert.equal(collectionDateIso(paidGateway), '2026-09-05T12:00:00.000Z');
    assert.equal(collectionDateIso({ ...paidGateway, paid_at: undefined }), null);
    assert.equal(missingPaidAtWhilePaid({ ...paidGateway, paid_at: undefined }), true);
    assert.equal(unpaidSalesTotal([pending, cash]), 4000);
  });
});
