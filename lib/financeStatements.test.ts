import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyBook, type OutletBook } from './outletBooks';
import {
  BS,
  assessBooksCompleteness,
  buildBalanceSheet,
  buildEquity,
  buildJournal,
  buildLedger,
  buildLedgerAccount,
  journalGroupBalanceIssues,
  receivableRevenueOf,
  settledCashRevenueOf,
  clearingRevenueOf
} from './financeStatements';

/** Fixture: tunai 11.000 + QRIS 4.000 = 15.000 (bukan 15.003). */
const CASH_AMT = 11000;
const QRIS_AMT = 4000;
const TOTAL = CASH_AMT + QRIS_AMT; // 15000

const aug = { year: 2026, month: 7 }; // Agustus
const sep = { year: 2026, month: 8 }; // September

const paidCash = {
  id: 't-cash',
  outlet_id: 'o1',
  amount: CASH_AMT,
  delivery_fee: 0,
  order_type: 'Offline',
  receipt_number: 'R-CASH',
  customer_name: 'A',
  created_at: '2026-09-10T10:00:00.000Z',
  is_paid: true,
  payment_status: 'paid',
  payment_method: 'Cash',
  status: 'Diterima'
};

const pendingQrisSep = {
  id: 't-qris',
  outlet_id: 'o1',
  amount: QRIS_AMT,
  delivery_fee: 0,
  order_type: 'Online',
  receipt_number: 'R-QRIS',
  customer_name: 'B',
  created_at: '2026-09-11T10:00:00.000Z',
  is_paid: false,
  payment_status: 'pending',
  payment_method: 'QRIS',
  status: 'menunggu_pembayaran'
};

/** Pending Agustus, lunas September (paid_at). */
const augPendingThenSepPaid = {
  id: 't-cross',
  outlet_id: 'o1',
  amount: QRIS_AMT,
  delivery_fee: 0,
  order_type: 'Online',
  receipt_number: 'R-CROSS',
  customer_name: 'C',
  created_at: '2026-08-20T10:00:00.000Z',
  is_paid: true,
  payment_status: 'paid',
  payment_method: 'QRIS',
  paid_via: 'GATEWAY',
  paid_at: '2026-09-05T08:00:00.000Z',
  status: 'paid'
};

function bookBase(): OutletBook {
  const b = emptyBook('o1');
  b.booksStart = '2026-01-01';
  b.openingCapital = 0;
  b.openingCash = 0;
  b.assets = [];
  return b;
}

describe('fixture arithmetic', () => {
  it('uses 11000 + 4000 = 15000', () => {
    assert.equal(TOTAL, 15000);
    assert.notEqual(TOTAL, 15003);
  });
});

describe('journal cash vs AR vs clearing', () => {
  it('posts pending to AR and cash sales to bank; totals 15000 revenue credit', () => {
    const rows = buildJournal({
      txs: [paidCash, pendingQrisSep],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      mode: 'month'
    });
    const cashDr = rows.filter((r) => r.akun.includes(BS.CASH.code) && r.debit > 0);
    const arDr = rows.filter((r) => r.akun.includes(BS.AR.code) && r.debit > 0);
    const revCr = rows.filter((r) => r.akun.startsWith('400') && r.kredit > 0);
    assert.equal(cashDr.reduce((s, r) => s + r.debit, 0), CASH_AMT);
    assert.equal(arDr.reduce((s, r) => s + r.debit, 0), QRIS_AMT);
    assert.equal(revCr.reduce((s, r) => s + r.kredit, 0), TOTAL);
    assert.equal(journalGroupBalanceIssues(rows).length, 0);
  });

  it('QRIS paid via gateway goes to clearing not bank', () => {
    const rows = buildJournal({
      txs: [augPendingThenSepPaid],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      mode: 'month'
    });
    const clearDr = rows.filter((r) => r.akun.includes(BS.CLEARING.code) && r.debit > 0);
    const bankDr = rows.filter((r) => r.akun.includes(BS.CASH.code) && r.debit > 0);
    assert.equal(clearDr.reduce((s, r) => s + r.debit, 0), QRIS_AMT);
    assert.equal(bankDr.length, 0);
  });
});

describe('August report stable when paid in September', () => {
  it('August stays Dr AR / Cr Revenue after status becomes paid with paid_at in September', () => {
    const asPending = {
      ...augPendingThenSepPaid,
      is_paid: false,
      payment_status: 'pending',
      paid_at: undefined,
      paid_via: undefined,
      status: 'menunggu_pembayaran'
    };
    const augBefore = buildJournal({
      txs: [asPending],
      mems: [],
      exps: [],
      books: [],
      ref: aug,
      mode: 'month'
    });
    const augAfter = buildJournal({
      txs: [augPendingThenSepPaid],
      mems: [],
      exps: [],
      books: [],
      ref: aug,
      mode: 'month'
    });

    const snap = (rows: typeof augBefore) =>
      rows
        .map((r) => `${r.akun}|${r.debit}|${r.kredit}|${r.source}`)
        .sort()
        .join(';');

    assert.equal(snap(augBefore), snap(augAfter));
    assert.ok(augAfter.some((r) => r.akun.includes(BS.AR.code) && r.debit === QRIS_AMT));
    assert.ok(!augAfter.some((r) => r.source === 'collection'));

    const sepRows = buildJournal({
      txs: [augPendingThenSepPaid],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      mode: 'month'
    });
    assert.ok(sepRows.some((r) => r.source === 'collection' && r.akun.includes(BS.CLEARING.code)));
    assert.ok(sepRows.some((r) => r.source === 'collection' && r.akun.includes(BS.AR.code) && r.kredit === QRIS_AMT));
  });

  it('without paid_at, flipping is_paid does not invent a September collection (history-safe)', () => {
    const paidNoDate = {
      ...augPendingThenSepPaid,
      paid_at: undefined,
      settled_at: undefined
    };
    const sepRows = buildJournal({
      txs: [paidNoDate],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      mode: 'month'
    });
    assert.ok(!sepRows.some((r) => r.source === 'collection'));
    const throughSep = buildBalanceSheet({
      txs: [paidNoDate],
      mems: [],
      exps: [],
      books: [bookBase()],
      asOf: sep
    });
    assert.equal(throughSep.tradeReceivablesFromSales, QRIS_AMT);
    assert.equal(throughSep.gatewayClearing, 0);
  });
});

describe('balance sheet bank vs AR vs clearing', () => {
  it('does not put pending omset into bank; 11000 bank + 4000 AR', () => {
    const sheet = buildBalanceSheet({
      txs: [paidCash, pendingQrisSep],
      mems: [],
      exps: [],
      books: [bookBase()],
      asOf: sep
    });
    assert.equal(settledCashRevenueOf([paidCash, pendingQrisSep], []), CASH_AMT);
    assert.equal(receivableRevenueOf([paidCash, pendingQrisSep], sep), QRIS_AMT);
    assert.equal(sheet.cash, CASH_AMT);
    assert.equal(sheet.tradeReceivablesFromSales, QRIS_AMT);
    assert.equal(sheet.gatewayClearing, 0);
    assert.ok(Math.abs(sheet.totalAssets - sheet.totalPasiva) < 2);
  });

  it('marks empty opening books as incomplete even if balanced at zero', () => {
    const c = assessBooksCompleteness([bookBase()]);
    assert.equal(c.complete, false);
    assert.ok(c.issues.length > 0);
  });

  it('cross-month: Aug AR then Sep clearing; bank still 0 for gateway QRIS', () => {
    const sheetAug = buildBalanceSheet({
      txs: [augPendingThenSepPaid],
      mems: [],
      exps: [],
      books: [bookBase()],
      asOf: aug
    });
    assert.equal(sheetAug.tradeReceivablesFromSales, QRIS_AMT);
    assert.equal(sheetAug.gatewayClearing, 0);
    assert.equal(sheetAug.cash, 0);

    const sheetSep = buildBalanceSheet({
      txs: [augPendingThenSepPaid],
      mems: [],
      exps: [],
      books: [bookBase()],
      asOf: sep
    });
    assert.equal(sheetSep.tradeReceivablesFromSales, 0);
    assert.equal(clearingRevenueOf([augPendingThenSepPaid], sep), QRIS_AMT);
    assert.equal(sheetSep.gatewayClearing, QRIS_AMT);
    assert.equal(sheetSep.cash, 0);
  });
});

describe('opening capital, asset, drawing', () => {
  it('opening journal balances and capital/prive flow', () => {
    const book = bookBase();
    book.openingCapital = 100000;
    book.openingCash = 100000;
    book.extraCapital = [{ id: 'c1', date: '2026-09-05', amount: 20000, note: 'setor' }];
    book.drawings = [{ id: 'd1', date: '2026-09-06', amount: 5000, note: 'prive' }];
    book.assets = [
      {
        id: 'fa1',
        name: 'Washer',
        category: 'Outlet - Machine',
        cost: 0,
        residual: 0,
        acquiredAt: '2026-01-01',
        lifeMonths: 60
      }
    ];
    const rows = buildJournal({ txs: [], mems: [], exps: [], books: [book], ref: sep, mode: 'month' });
    assert.equal(journalGroupBalanceIssues(rows).length, 0);
    const sheet = buildBalanceSheet({ txs: [], mems: [], exps: [], books: [book], asOf: sep });
    assert.equal(sheet.cash, 100000 + 20000 - 5000);
    assert.ok(Math.abs(sheet.totalAssets - sheet.totalPasiva) < 2);
  });

  it('skips txs before booksStart', () => {
    const book = bookBase();
    book.booksStart = '2026-09-15';
    book.openingCapital = 1;
    book.openingCash = 1;
    const early = { ...paidCash, created_at: '2026-09-01T00:00:00.000Z' };
    const rows = buildJournal({ txs: [early], mems: [], exps: [], books: [book], ref: sep, mode: 'month' });
    assert.ok(!rows.some((r) => r.source === 'transaction'));
  });
});

describe('ledger drill-down', () => {
  it('account closing matches summary saldo', () => {
    const opts = {
      txs: [paidCash, pendingQrisSep],
      mems: [],
      exps: [],
      books: [] as OutletBook[],
      asOf: sep
    };
    const summary = buildLedger(opts).find((r) => r.name.includes(BS.CASH.code));
    const detail = buildLedgerAccount({ ...opts, account: summary!.name });
    assert.equal(detail.closing, summary!.saldo);
    assert.ok(detail.mutations.length > 0);
  });
});

describe('equity labels basis', () => {
  it('exposes period profit before and after share on 15000', () => {
    const eq = buildEquity({
      txs: [paidCash, pendingQrisSep],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      rates: {}
    });
    assert.equal(eq.periodProfit, TOTAL);
    assert.equal(eq.periodProfitAfterShare, TOTAL - Math.round(TOTAL * 0.2));
  });
});

describe('expense kasbon note (policy unchanged)', () => {
  it('still posts kasbon category as expense vs cash (no silent AR rewrite)', () => {
    const exp = {
      id: 'e1',
      outlet_id: 'o1',
      amount: 1000,
      category: '600011 · Kasbon Crew',
      description: 'Kasbon',
      created_at: '2026-09-12T00:00:00.000Z'
    };
    const rows = buildJournal({ txs: [], mems: [], exps: [exp], books: [], ref: sep, mode: 'month' });
    assert.ok(rows.some((r) => r.akun.includes('600011') && r.debit === 1000));
    assert.ok(rows.some((r) => r.akun.includes(BS.CASH.code) && r.kredit === 1000));
  });
});

describe('representative recon sample', () => {
  it('jurnal = ledger = neraca assets for mixed month', () => {
    const txs = [paidCash, pendingQrisSep, augPendingThenSepPaid];
    const books = [bookBase()];
    const journalSep = buildJournal({ txs, mems: [], exps: [], books, ref: sep, mode: 'month' });
    assert.equal(journalGroupBalanceIssues(journalSep).length, 0);

    const ledger = buildLedger({ txs, mems: [], exps: [], books, asOf: sep });
    const bank = ledger.find((r) => r.name.includes(BS.CASH.code))?.saldo || 0;
    const ar = ledger.find((r) => r.name.includes(BS.AR.code))?.saldo || 0;
    const clearing = ledger.find((r) => r.name.includes(BS.CLEARING.code))?.saldo || 0;
    const sheet = buildBalanceSheet({ txs, mems: [], exps: [], books, asOf: sep });

    assert.equal(bank, sheet.cash);
    assert.equal(ar, sheet.receivables);
    assert.equal(clearing, sheet.gatewayClearing);
    // Sep: cash 11000 + clearing 4000 (from Aug sale paid Sep) + AR 4000 pending Sep = 19000 current from sales
    assert.equal(sheet.cash, CASH_AMT);
    assert.equal(sheet.gatewayClearing, QRIS_AMT);
    assert.equal(sheet.tradeReceivablesFromSales, QRIS_AMT);
  });
});
