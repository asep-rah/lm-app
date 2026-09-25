import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyBook, type OutletBook } from './outletBooks';
import { depositPaidOf, parseSplitLabel, paymentPartsOf } from './paymentParts';
import { buildPnlMonth } from './pnlReport';
import { validateSettlement, settlementForJournal } from './financeSettlement';
import {
  BS,
  buildBalanceSheet,
  buildJournal,
  buildLedger,
  journalGroupBalanceIssues,
  type FinanceSettlement
} from './financeStatements';

const sep = { year: 2026, month: 8 };
const oct = { year: 2026, month: 9 };
const OUT = '0a000000-0000-4000-8000-00000000000a';
const book = (o: Partial<OutletBook> = {}): OutletBook =>
  Object.assign(emptyBook(OUT), { booksStart: '2026-01-01', openingCapital: 10_000_000, openingCash: 10_000_000, assets: [] }, o);
const sale = (o: Record<string, unknown> = {}) => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  outlet_id: OUT,
  delivery_fee: 0,
  order_type: 'Offline',
  receipt_number: 'R',
  customer_name: 'X',
  is_paid: true,
  payment_status: 'paid',
  status: 'Selesai',
  payment_method: 'Cash',
  amount: 100_000,
  created_at: '2026-09-10T10:00:00.000Z',
  ...o
});
const exp = (o: Record<string, unknown> = {}) => ({ id: `e-${Math.random().toString(36).slice(2)}`, outlet_id: OUT, description: 'x', ...o });

type Rows = Record<string, unknown>[];
type Args = { txs?: Rows; mems?: Rows; exps?: Rows; deposits?: Rows; settlements?: FinanceSettlement[]; asOf?: { year: number; month: number } };
const sheetOf = (a: Args) => {
  const args = { txs: a.txs || [], mems: a.mems || [], exps: a.exps || [], books: [book()], asOf: a.asOf || sep, deposits: a.deposits, settlements: a.settlements };
  const s = buildBalanceSheet(args);
  assert.equal(Math.round(s.totalAssets - s.totalPasiva), 0, 'aset = liabilitas + ekuitas');
  assert.deepEqual(journalGroupBalanceIssues(buildJournal({ ...args, ref: args.asOf, mode: 'through' })), []);
  const ledger = buildLedger(args);
  const saldo = (code: string) => ledger.find((r) => r.name.startsWith(code))?.saldo || 0;
  assert.equal(s.cash, saldo(BS.CASH.code));
  assert.equal(s.undepositedCash, saldo(BS.UNDEPOSITED.code));
  assert.equal(s.gatewayClearing, saldo(BS.CLEARING.code));
  assert.equal(s.thrFund, saldo(BS.THR_FUND.code));
  assert.equal(s.thrPayable, saldo(BS.THR_PAYABLE.code));
  return s;
};

describe('payment parts', () => {
  it('parses POS split labels (id-ID thousands)', () => {
    assert.deepEqual(parseSplitLabel('Deposit Saldo (Rp 50.000) + Cash (Rp 30.000)'), [
      { method: 'Deposit Saldo', amount: 50000 },
      { method: 'Cash', amount: 30000 }
    ]);
    assert.equal(parseSplitLabel('Cash'), null);
    assert.equal(parseSplitLabel('QRIS'), null);
  });
  it('single methods, splits, scaling to the amount', () => {
    assert.deepEqual(paymentPartsOf({ amount: 80000, payment_method: 'Deposit Member' }), [{ kind: 'deposit', amount: 80000 }]);
    assert.deepEqual(paymentPartsOf({ amount: 80000, payment_method: 'QRIS' }), [{ kind: 'noncash', amount: 80000 }]);
    assert.deepEqual(paymentPartsOf({ amount: 80000, payment_method: 'QRIS (Rp 50.000) + Cash (Rp 30.000)' }), [
      { kind: 'noncash', amount: 50000 },
      { kind: 'cash', amount: 30000 }
    ]);
    // Ongkir ditambah setelah split: bagian diskalakan, jumlah tetap = amount.
    const scaled = paymentPartsOf({ amount: 90000, payment_method: 'Deposit Saldo (Rp 40.000) + Cash (Rp 40.000)' });
    assert.equal(scaled.reduce((s, p) => s + p.amount, 0), 90000);
    assert.equal(depositPaidOf({ amount: 80000, payment_method: 'Deposit Saldo (Rp 50.000) + Cash (Rp 30.000)' }), 50000);
  });
});

describe('1. top up deposit = omset once; paying with the balance is not omset again', () => {
  it('P&L: deposit-paid sale adds no revenue; split counts only the non-deposit part', () => {
    const pnl = buildPnlMonth(
      {
        txs: [sale({ payment_method: 'Deposit Member' }), sale({ amount: 80000, payment_method: 'Deposit Saldo (Rp 50.000) + Cash (Rp 30.000)' })],
        mems: [{ id: 'm', outlet_id: OUT, price: 100000, order_type: 'Offline', created_at: '2026-09-02T10:00:00.000Z' }],
        exps: []
      },
      sep
    );
    assert.equal(pnl.revenue['400008'], 100000, 'top up = omset');
    assert.equal(pnl.revenue['400005'], 30000, 'only the cash part of the split');
  });
  it('neraca: top up cash goes to the drawer; paying with the balance adds no cash', () => {
    const s = sheetOf({
      mems: [{ id: 'm', outlet_id: OUT, price: 100000, order_type: 'Offline', created_at: '2026-09-02T10:00:00.000Z' }],
      txs: [sale({ payment_method: 'Deposit Member' })]
    });
    assert.equal(s.undepositedCash, 100000);
    assert.equal(s.yearProfit - s.profitShare >= 0, true);
  });
  it('online top up (Mayar QRIS) goes to clearing', () => {
    const s = sheetOf({ mems: [{ id: 'm', outlet_id: OUT, price: 50000, order_type: 'Online', created_at: '2026-09-02T10:00:00.000Z' }] });
    assert.equal(s.gatewayClearing, 50000);
    assert.equal(s.undepositedCash, 0);
  });
});

describe('2. split payment + cash setoran', () => {
  it('QRIS part → piutang then clearing when paid; cash part → drawer', () => {
    const split = sale({ amount: 80000, payment_method: 'QRIS (Rp 50.000) + Cash (Rp 30.000)', paid_via: 'GATEWAY', paid_at: '2026-09-10T11:00:00.000Z' });
    const s = sheetOf({ txs: [split] });
    assert.equal(s.undepositedCash, 30000);
    assert.equal(s.gatewayClearing, 50000);
    assert.equal(s.receivables, 0);
  });
  it('QRIS part not yet paid stays piutang', () => {
    const s = sheetOf({ txs: [sale({ amount: 80000, payment_method: 'QRIS (Rp 50.000) + Cash (Rp 30.000)', is_paid: false, payment_status: 'pending' })] });
    assert.equal(s.receivables, 50000);
    assert.equal(s.undepositedCash, 30000);
  });
  it('balanced cash setoran moves net cash from the drawer to clearing; pending does nothing', () => {
    const deposits = [
      { id: 'd1', outlet_id: OUT, amount_cash: 100000, admin_fee: 2500, net_deposit_amount: 97500, status: 'BALANCED', paid_at: '2026-09-11T10:00:00.000Z', created_at: '2026-09-11T09:00:00.000Z' },
      { id: 'd2', outlet_id: OUT, amount_cash: 50000, admin_fee: 0, net_deposit_amount: 50000, status: 'PENDING', created_at: '2026-09-11T09:00:00.000Z' }
    ];
    const s = sheetOf({
      txs: [sale({ amount: 150000 })],
      exps: [exp({ amount: 2500, category: 'Biaya Admin', created_at: '2026-09-11T10:00:00.000Z' })],
      deposits
    });
    assert.equal(s.undepositedCash, 150000 - 2500 - 97500);
    assert.equal(s.gatewayClearing, 97500);
  });
});

describe('3. + 4. bagi hasil / THR payments and the THR savings', () => {
  it('Tabungan THR: money moves to Dana Tabungan THR and is owed to crew; P&L format unchanged', () => {
    const thr = exp({ amount: 200000, category: 'Tabungan THR', created_at: '2026-09-15T10:00:00.000Z' });
    const s = sheetOf({ txs: [sale({ amount: 1_000_000 })], exps: [thr] });
    assert.equal(s.thrFund, 200000);
    assert.equal(s.thrPayable, 200000);
    assert.equal(s.undepositedCash, 800000);
    const pnl = buildPnlMonth({ txs: [sale({ amount: 1_000_000 })], mems: [], exps: [thr] }, sep);
    assert.equal(pnl.tabunganThr, 200000);
    assert.equal(pnl.bagiHasil, 200000, 'bagi hasil before THR savings, as before');
  });
  it('paying THR from the fund clears both; paying bagi hasil from the bank clears the liability', () => {
    const thr = exp({ amount: 200000, category: 'Tabungan THR', created_at: '2026-09-15T10:00:00.000Z' });
    const settlements: FinanceSettlement[] = [
      { id: 's1', outlet_id: OUT, kind: 'thr', amount: 200000, paid_at: '2026-09-28T12:00:00+07:00', source: 'dana_thr' },
      { id: 's2', outlet_id: OUT, kind: 'profit_share', amount: 200000, paid_at: '2026-10-03T12:00:00+07:00', source: 'bank' },
      { id: 's3', outlet_id: OUT, kind: 'profit_share', amount: 999999, paid_at: '2026-10-03T12:00:00+07:00', source: 'bank', voided_at: '2026-10-04T00:00:00Z' }
    ];
    const s = sheetOf({ txs: [sale({ amount: 1_000_000 })], exps: [thr], settlements, asOf: oct });
    assert.equal(s.thrFund, 0);
    assert.equal(s.thrPayable, 0);
    assert.equal(s.profitShare, 0);
    assert.equal(s.cash, 10_000_000 - 200000);
  });
  it('settlement validation', () => {
    const ok = validateSettlement({ outletId: OUT, kind: 'thr', amount: 150000, paidAt: '2026-09-20', source: 'dana_thr', note: ' Lebaran ' }, '2026-09-25');
    assert.deepEqual(ok, { ok: true, draft: { outlet_id: OUT, kind: 'thr', amount: 150000, paid_at: '2026-09-20', source: 'dana_thr', note: 'Lebaran' } });
    const bad = [
      { outletId: 'x', kind: 'thr', amount: 1, paidAt: '2026-09-20', source: 'bank' },
      { outletId: OUT, kind: 'bonus', amount: 1, paidAt: '2026-09-20', source: 'bank' },
      { outletId: OUT, kind: 'thr', amount: 0, paidAt: '2026-09-20', source: 'bank' },
      { outletId: OUT, kind: 'thr', amount: 1, paidAt: '2026-10-01', source: 'bank' },
      { outletId: OUT, kind: 'profit_share', amount: 1, paidAt: '2026-09-20', source: 'dana_thr' }
    ];
    for (const b of bad) assert.equal(validateSettlement(b, '2026-09-25').ok, false, JSON.stringify(b));
    assert.equal(settlementForJournal({ id: 'a', outlet_id: OUT, kind: 'thr', amount: '5', paid_at: '2026-09-30', source: 'bank' }).paid_at, '2026-09-30T12:00:00+07:00');
  });
});

describe('6. void in a later month is reversed in the void month (P&L and neraca agree)', () => {
  const v = sale({ amount: 100000, is_void: true, status: 'Dibatalkan', voided_at: '2026-10-05T10:00:00.000Z' });
  it('P&L: September keeps the sale, October shows the reversal; same-month void is 0', () => {
    assert.equal(buildPnlMonth({ txs: [v], mems: [], exps: [] }, sep).revenue['400005'], 100000);
    assert.equal(buildPnlMonth({ txs: [v], mems: [], exps: [] }, oct).revenue['400005'], -100000);
    const same = sale({ is_void: true, voided_at: '2026-09-12T10:00:00.000Z' });
    assert.equal(buildPnlMonth({ txs: [same], mems: [], exps: [] }, sep).revenue['400005'], 0);
    const noDate = sale({ is_void: true });
    assert.equal(buildPnlMonth({ txs: [noDate], mems: [], exps: [] }, sep).revenue['400005'], 0);
  });
  it('neraca: September shows the sale, October nets to zero; bagi hasil follows the P&L', () => {
    const s9 = sheetOf({ txs: [v] });
    assert.equal(s9.undepositedCash, 100000);
    assert.equal(s9.profitShare, 20000);
    const s10 = sheetOf({ txs: [v], asOf: oct });
    assert.equal(s10.undepositedCash, 0);
    // Aturan laba rugi yang ada: bagi hasil per bulan, bulan rugi = 0. Bagi hasil September tetap terutang;
    // Oktober rugi karena pembalikan (tidak ada bagi hasil negatif).
    assert.equal(s10.profitShare, 20000);
    assert.equal(buildPnlMonth({ txs: [v], mems: [], exps: [] }, oct).bagiHasil, 0);
  });
});
