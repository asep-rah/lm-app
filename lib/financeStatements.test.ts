import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyBook, type OutletBook } from './outletBooks';
import { buildTransactionReconRows } from './financeRecognition';
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
  clearingRevenueOf,
  undepositedCashRevenueOf
} from './financeStatements';

/** Tiga transaksi BERBEDA — total aset 19.000 bukan double-count satu nota. */
const CASH_AMT = 11000; // R-CASH
const QRIS_PENDING_AMT = 4000; // R-QRIS-SEP (masih piutang)
const QRIS_CROSS_AMT = 4000; // R-CROSS (jual Aug, bayar Sep → clearing)
const TOTAL_REV_SEP_SALES = CASH_AMT + QRIS_PENDING_AMT; // 15000 penjualan bertanggal Sep
const TOTAL_ASSETS_FROM_SALES = CASH_AMT + QRIS_PENDING_AMT + QRIS_CROSS_AMT; // 19000

const aug = { year: 2026, month: 7 };
const sep = { year: 2026, month: 8 };

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
  id: 't-qris-sep',
  outlet_id: 'o1',
  amount: QRIS_PENDING_AMT,
  delivery_fee: 0,
  order_type: 'Online',
  receipt_number: 'R-QRIS-SEP',
  customer_name: 'B',
  created_at: '2026-09-11T10:00:00.000Z',
  is_paid: false,
  payment_status: 'pending',
  payment_method: 'QRIS',
  status: 'menunggu_pembayaran'
};

const augPendingThenSepPaid = {
  id: 't-cross',
  outlet_id: 'o1',
  amount: QRIS_CROSS_AMT,
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

describe('per-transaction recon table (no double count)', () => {
  it('documents 11000 undeposited + 4000 AR + 4000 clearing from THREE ids', () => {
    const txs = [paidCash, pendingQrisSep, augPendingThenSepPaid];
    const asOf = '2026-09-30T23:59:59.000Z';
    const table = buildTransactionReconRows(txs, asOf);

    assert.equal(table.length, 3);
    assert.equal(new Set(table.map((r) => r.id)).size, 3);

    const byReceipt = Object.fromEntries(table.map((r) => [r.receipt, r]));
    assert.equal(byReceipt['R-CASH'].endingBucket, 'undeposited');
    assert.equal(byReceipt['R-CASH'].endingAmount, CASH_AMT);
    assert.equal(byReceipt['R-CASH'].paidAt, null);
    assert.ok(byReceipt['R-CASH'].journals.some((j) => j.includes('110005')));

    assert.equal(byReceipt['R-QRIS-SEP'].endingBucket, 'receivable');
    assert.equal(byReceipt['R-QRIS-SEP'].endingAmount, QRIS_PENDING_AMT);
    assert.equal(byReceipt['R-QRIS-SEP'].orderAt.startsWith('2026-09'), true);

    assert.equal(byReceipt['R-CROSS'].endingBucket, 'clearing');
    assert.equal(byReceipt['R-CROSS'].endingAmount, QRIS_CROSS_AMT);
    assert.equal(byReceipt['R-CROSS'].orderAt.startsWith('2026-08'), true);
    assert.equal(byReceipt['R-CROSS'].paidAt?.startsWith('2026-09'), true);

    const sumEnding = table.reduce((s, r) => s + r.endingAmount, 0);
    assert.equal(sumEnding, TOTAL_ASSETS_FROM_SALES);
    assert.equal(TOTAL_ASSETS_FROM_SALES, 19000);
    assert.equal(TOTAL_REV_SEP_SALES, 15000);
  });
});

describe('journal undeposited vs AR vs clearing', () => {
  it('cash sale hits 110005 not 110001 until deposited', () => {
    const rows = buildJournal({
      txs: [paidCash, pendingQrisSep],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      mode: 'month'
    });
    const undDr = rows.filter((r) => r.akun.includes(BS.UNDEPOSITED.code) && r.debit > 0);
    const bankDr = rows.filter((r) => r.akun.includes(BS.CASH.code) && r.debit > 0);
    const arDr = rows.filter((r) => r.akun.includes(BS.AR.code) && r.debit > 0);
    assert.equal(undDr.reduce((s, r) => s + r.debit, 0), CASH_AMT);
    assert.equal(bankDr.length, 0);
    assert.equal(arDr.reduce((s, r) => s + r.debit, 0), QRIS_PENDING_AMT);
  });

  it('deposit moves undeposited → bank without touching August', () => {
    const deposited = { ...paidCash, deposited_at: '2026-09-12T00:00:00.000Z' };
    const sepRows = buildJournal({ txs: [deposited], mems: [], exps: [], books: [], ref: sep, mode: 'month' });
    assert.ok(sepRows.some((r) => r.source === 'deposit' && r.akun.includes(BS.CASH.code)));
    const sheet = buildBalanceSheet({ txs: [deposited], mems: [], exps: [], books: [bookBase()], asOf: sep });
    assert.equal(sheet.cash, CASH_AMT);
    assert.equal(sheet.undepositedCash, 0);
  });
});

describe('August stable under later mutations', () => {
  it('status flip to paid with Sep paid_at leaves August journal identical', () => {
    const asPending = {
      ...augPendingThenSepPaid,
      is_paid: false,
      payment_status: 'pending',
      paid_at: undefined,
      paid_via: undefined,
      status: 'menunggu_pembayaran'
    };
    const snap = (rows: ReturnType<typeof buildJournal>) =>
      rows
        .map((r) => `${r.akun}|${r.debit}|${r.kredit}|${r.source}`)
        .sort()
        .join(';');
    const before = buildJournal({ txs: [asPending], mems: [], exps: [], books: [], ref: aug, mode: 'month' });
    const after = buildJournal({
      txs: [augPendingThenSepPaid],
      mems: [],
      exps: [],
      books: [],
      ref: aug,
      mode: 'month'
    });
    assert.equal(snap(before), snap(after));
  });

  it('correcting paid_at within September does not change August', () => {
    const paidEarly = { ...augPendingThenSepPaid, paid_at: '2026-09-01T00:00:00.000Z' };
    const paidLate = { ...augPendingThenSepPaid, paid_at: '2026-09-28T00:00:00.000Z' };
    const snap = (rows: ReturnType<typeof buildJournal>) =>
      rows.map((r) => `${r.akun}|${r.debit}|${r.kredit}|${r.source}`).sort().join(';');
    assert.equal(
      snap(buildJournal({ txs: [paidEarly], mems: [], exps: [], books: [], ref: aug, mode: 'month' })),
      snap(buildJournal({ txs: [paidLate], mems: [], exps: [], books: [], ref: aug, mode: 'month' }))
    );
  });

  it('manual mark paid with paid_at posts clearing/bank collection only on pay month', () => {
    const manual = {
      ...pendingQrisSep,
      id: 't-manual',
      receipt_number: 'R-MAN',
      is_paid: true,
      payment_status: 'paid',
      paid_via: 'MANUAL_VERIFIED',
      paid_at: '2026-09-15T00:00:00.000Z',
      status: 'paid'
    };
    const createdOnly = { ...manual, is_paid: false, payment_status: 'pending', paid_at: undefined, paid_via: undefined };
    const snapAug = (t: typeof manual) =>
      buildJournal({ txs: [{ ...t, created_at: '2026-08-10T00:00:00.000Z' }], mems: [], exps: [], books: [], ref: aug, mode: 'month' })
        .map((r) => `${r.source}|${r.akun}|${r.debit}`)
        .sort()
        .join(';');
    // Sale in August pending then manual paid September
    const pendingAug = {
      ...createdOnly,
      created_at: '2026-08-10T00:00:00.000Z'
    };
    const paidSep = {
      ...manual,
      created_at: '2026-08-10T00:00:00.000Z',
      paid_at: '2026-09-15T00:00:00.000Z'
    };
    const augPending = buildJournal({ txs: [pendingAug], mems: [], exps: [], books: [], ref: aug, mode: 'month' });
    const augAfterPay = buildJournal({ txs: [paidSep], mems: [], exps: [], books: [], ref: aug, mode: 'month' });
    assert.equal(
      augPending.map((r) => `${r.akun}|${r.debit}|${r.kredit}`).sort().join(';'),
      augAfterPay.map((r) => `${r.akun}|${r.debit}|${r.kredit}`).sort().join(';')
    );
    const sepPay = buildJournal({ txs: [paidSep], mems: [], exps: [], books: [], ref: sep, mode: 'month' });
    assert.ok(sepPay.some((r) => r.source === 'collection' && r.akun.includes(BS.CASH.code)));
  });

  it('void with voided_at reverses in void month; sale month keeps original lines', () => {
    const voided = {
      ...paidCash,
      is_void: true,
      status: 'Dibatalkan',
      voided_at: '2026-09-20T00:00:00.000Z'
    };
    const augLike = {
      ...voided,
      created_at: '2026-08-15T00:00:00.000Z',
      voided_at: '2026-09-20T00:00:00.000Z'
    };
    const augRows = buildJournal({ txs: [augLike], mems: [], exps: [], books: [], ref: aug, mode: 'month' });
    assert.ok(augRows.some((r) => r.source === 'transaction' && r.debit > 0));
    assert.ok(!augRows.some((r) => r.source === 'void'));
    const sepRows = buildJournal({ txs: [augLike], mems: [], exps: [], books: [], ref: sep, mode: 'month' });
    assert.ok(sepRows.some((r) => r.source === 'void'));
  });
});

describe('balance sheet buckets', () => {
  it('mixed September: undeposited 11000 + AR 4000 + clearing 4000', () => {
    const txs = [paidCash, pendingQrisSep, augPendingThenSepPaid];
    const sheet = buildBalanceSheet({ txs, mems: [], exps: [], books: [bookBase()], asOf: sep });
    assert.equal(undepositedCashRevenueOf(txs, sep), CASH_AMT);
    assert.equal(sheet.undepositedCash, CASH_AMT);
    assert.equal(sheet.cash, 0);
    assert.equal(sheet.tradeReceivablesFromSales, QRIS_PENDING_AMT);
    assert.equal(sheet.gatewayClearing, QRIS_CROSS_AMT);
    assert.equal(
      sheet.undepositedCash + sheet.tradeReceivablesFromSales + sheet.gatewayClearing,
      TOTAL_ASSETS_FROM_SALES
    );
    assert.ok(Math.abs(sheet.totalAssets - sheet.totalPasiva) < 2);
  });

  it('marks empty opening books incomplete', () => {
    assert.equal(assessBooksCompleteness([bookBase()]).complete, false);
  });
});

describe('opening capital', () => {
  it('opening + capital - prive hits bank', () => {
    const book = bookBase();
    book.openingCapital = 100000;
    book.openingCash = 100000;
    book.extraCapital = [{ id: 'c1', date: '2026-09-05', amount: 20000, note: 'setor' }];
    book.drawings = [{ id: 'd1', date: '2026-09-06', amount: 5000, note: 'prive' }];
    book.assets = [];
    const sheet = buildBalanceSheet({ txs: [], mems: [], exps: [], books: [book], asOf: sep });
    assert.equal(sheet.cash, 100000 + 20000 - 5000);
  });
});

describe('ledger / equity / expense', () => {
  it('ledger closing matches', () => {
    const opts = { txs: [paidCash, pendingQrisSep], mems: [], exps: [], books: [] as OutletBook[], asOf: sep };
    const summary = buildLedger(opts).find((r) => r.name.includes(BS.UNDEPOSITED.code));
    const detail = buildLedgerAccount({ ...opts, account: summary!.name });
    assert.equal(detail.closing, summary!.saldo);
  });

  it('equity on 15000 sep sales only', () => {
    const eq = buildEquity({
      txs: [paidCash, pendingQrisSep],
      mems: [],
      exps: [],
      books: [],
      ref: sep,
      rates: {}
    });
    assert.equal(eq.periodProfit, 15000);
  });

  it('kasbon expenses credit undeposited cash', () => {
    const exp = {
      id: 'e1',
      outlet_id: 'o1',
      amount: 1000,
      category: '600011 · Kasbon Crew',
      description: 'Kasbon',
      created_at: '2026-09-12T00:00:00.000Z'
    };
    const rows = buildJournal({ txs: [], mems: [], exps: [exp], books: [], ref: sep, mode: 'month' });
    assert.ok(rows.some((r) => r.akun.includes(BS.UNDEPOSITED.code) && r.kredit === 1000));
  });
});

describe('representative recon sample', () => {
  it('jurnal groups balanced; ledger matches neraca buckets', () => {
    const txs = [paidCash, pendingQrisSep, augPendingThenSepPaid];
    const books = [bookBase()];
    const journalSep = buildJournal({ txs, mems: [], exps: [], books, ref: sep, mode: 'month' });
    assert.equal(journalGroupBalanceIssues(journalSep).length, 0);
    const ledger = buildLedger({ txs, mems: [], exps: [], books, asOf: sep });
    const sheet = buildBalanceSheet({ txs, mems: [], exps: [], books, asOf: sep });
    const und = ledger.find((r) => r.name.includes(BS.UNDEPOSITED.code))?.saldo || 0;
    const ar = ledger.find((r) => r.name.includes(BS.AR.code))?.saldo || 0;
    const clearing = ledger.find((r) => r.name.includes(BS.CLEARING.code))?.saldo || 0;
    assert.equal(und, sheet.undepositedCash);
    assert.equal(ar, sheet.receivables);
    assert.equal(clearing, sheet.gatewayClearing);
  });
});
