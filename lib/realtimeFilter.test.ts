import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { debounce, phoneInFilter, threadKeyFilter } from './realtimeFilter';

describe('phoneInFilter', () => {
  it('membangun filter in dari varian nomor, tanpa duplikat', () => {
    assert.equal(
      phoneInFilter('customer_phone', ['081234567890', '6281234567890', '+6281234567890', '081234567890']),
      'customer_phone=in.(081234567890,6281234567890,+6281234567890)'
    );
  });
  it('membuang nilai yang bisa merusak string filter', () => {
    assert.equal(phoneInFilter('customer_phone', ['0812,34', 'abc', '', '6281234567890)']), null);
  });
  it('null bila kosong', () => {
    assert.equal(phoneInFilter('customer_phone', []), null);
  });
});

describe('threadKeyFilter', () => {
  it('menerima kunci thread nomor', () => {
    assert.equal(threadKeyFilter('p:6281234567890'), 'thread_key=eq.p:6281234567890');
  });
  it('menolak kunci tidak valid', () => {
    assert.equal(threadKeyFilter(''), null);
    assert.equal(threadKeyFilter('unknown'), null);
    assert.equal(threadKeyFilter('p:62,1)'), null);
  });
});

describe('debounce', () => {
  it('beberapa panggilan beruntun → satu eksekusi dengan argumen terakhir', async () => {
    const calls: number[] = [];
    const d = debounce((n: number) => calls.push(n), 20);
    d(1);
    d(2);
    d(3);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(calls, [3]);
  });
  it('cancel membatalkan eksekusi tertunda', async () => {
    const calls: number[] = [];
    const d = debounce((n: number) => calls.push(n), 20);
    d(1);
    d.cancel();
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(calls, []);
  });
});
