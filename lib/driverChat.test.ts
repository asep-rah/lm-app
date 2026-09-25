import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanDriverChatText, DRIVER_CHAT_MAX_LENGTH, isDriverChatOpen, sameDriverName } from './driverChat';
import { isOrderId, orderBelongsTo, type ChatOrder } from './driverChatServer';

const order = (over: Partial<ChatOrder> = {}): ChatOrder => ({
  id: '123e4567-e89b-42d3-a456-000000000001',
  order_number: 'ORD-20260924-0001',
  customer_name: 'Budi',
  customer_phone: '081234567890',
  phone_number: null,
  driver_name: 'Andi',
  status: 'Driver Menuju Lokasi',
  ...over
});

describe('driver chat rules', () => {
  it('is open only while a driver runs the trip', () => {
    assert.equal(isDriverChatOpen(order()), true);
    assert.equal(isDriverChatOpen(order({ status: 'Barang Dibawa ke Outlet' })), true);
    assert.equal(isDriverChatOpen(order({ status: 'Driver Mengantar' })), true);
    for (const status of ['Menunggu Kurir', 'Telah Tiba di Outlet', 'Terkirim', 'Selesai', 'Dibatalkan', '']) {
      assert.equal(isDriverChatOpen(order({ status })), false, status);
    }
    assert.equal(isDriverChatOpen(order({ driver_name: '  ' })), false);
    assert.equal(isDriverChatOpen(null), false);
  });

  it('matches the assigned driver by name, ignoring case and spacing', () => {
    assert.equal(sameDriverName('Andi  Saputra', ' andi saputra '), true);
    assert.equal(sameDriverName('Andi', 'Andika'), false);
    assert.equal(sameDriverName('', ''), false);
  });

  it('cleans message text', () => {
    assert.equal(cleanDriverChatText('  halo\u0000 kak  '), 'halo  kak');
    assert.equal(cleanDriverChatText('a\r\nb\n\n\n\nc'), 'a\nb\n\nc');
    assert.equal(cleanDriverChatText('   '), '');
    assert.equal(cleanDriverChatText(null), '');
    assert.equal(cleanDriverChatText('x'.repeat(5000)).length, DRIVER_CHAT_MAX_LENGTH);
  });

  it('an order belongs only to its own customer phone (any stored format)', () => {
    assert.equal(orderBelongsTo(order(), '081234567890'), true);
    assert.equal(orderBelongsTo(order({ customer_phone: '6281234567890' }), '081234567890'), true);
    assert.equal(orderBelongsTo(order({ customer_phone: null, phone_number: '+6281234567890' }), '081234567890'), true);
    assert.equal(orderBelongsTo(order(), '081299999999'), false);
    assert.equal(orderBelongsTo(order(), ''), false);
    assert.equal(orderBelongsTo(order({ customer_phone: null }), ''), false);
  });

  it('accepts only uuid order ids', () => {
    assert.equal(isOrderId('123e4567-e89b-42d3-a456-000000000001'), true);
    assert.equal(isOrderId('1; drop table x'), false);
    assert.equal(isOrderId(undefined), false);
  });
});
