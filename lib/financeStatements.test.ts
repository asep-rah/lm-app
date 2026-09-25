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

describe('accounting integrity: neraca = buku besar, aset = liabilitas + ekuitas', () => {
  const book = (o: Partial<OutletBook> = {}): OutletBook =>
    Object.assign(emptyBook('o1'), { booksStart: '2026-01-01', openingCapital: 10_000_000, openingCash: 10_000_000, assets: [] }, o);
  const sale = (o: Record<string, unknown> = {}) => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    outlet_id: 'o1',
    delivery_fee: 0,
    order_type: 'Offline',
    receipt_number: 'R',
    customer_name: 'X',
    is_paid: true,
    payment_status: 'paid',
    payment_method: 'Cash',
    status: 'Selesai',
    amount: 100_000,
    created_at: '2026-09-10T10:00:00.000Z',
    ...o
  });
  const expense = (o: Record<string, unknown> = {}) => ({ id: `e-${Math.random().toString(36).slice(2)}`, outlet_id: 'o1', category: 'Beban Gaji Crew', description: 'x', ...o });
  const mesin = (acquiredAt: string) => ({ id: 'a1', name: 'Mesin', category: 'Mesin & Peralatan', cost: 6_000_000, residual: 0, lifeMonths: 60, acquiredAt });

  const check = (args: { txs?: any[]; mems?: any[]; exps?: any[]; books?: OutletBook[]; asOf?: { year: number; month: number } }) => {
    const a = { txs: args.txs || [], mems: args.mems || [], exps: args.exps || [], books: args.books || [book()], asOf: args.asOf || sep };
    const sheet = buildBalanceSheet(a);
    const ledger = buildLedger(a);
    const saldo = (code: string) => ledger.find((r) => r.name.startsWith(code))?.saldo || 0;
    assert.equal(Math.round(sheet.totalAssets - sheet.totalPasiva), 0, 'aset = liabilitas + ekuitas');
    assert.equal(sheet.cash, saldo(BS.CASH.code));
    assert.equal(sheet.undepositedCash, saldo(BS.UNDEPOSITED.code));
    assert.equal(sheet.receivables, saldo(BS.AR.code));
    assert.equal(sheet.gatewayClearing, saldo(BS.CLEARING.code));
    assert.equal(sheet.accumDep, saldo(BS.ACCUM.code));
    assert.equal(sheet.profitShare, saldo(BS.BH.code));
    // Baris ekuitas di neraca dijumlahkan persis menjadi Jumlah Ekuitas.
    assert.equal(
      Math.round(sheet.paidInCapital + sheet.openingGap - sheet.drawings + sheet.retainedPrior + sheet.yearProfit),
      Math.round(sheet.totalEquity)
    );
    // Laporan perubahan ekuitas: awal tahun + setoran + laba − prive = akhir.
    assert.equal(Math.round(sheet.equityBegin + sheet.extraYear + sheet.yearProfit - sheet.drawingsYear), Math.round(sheet.totalEquity));
    const journal = buildJournal({ ...a, ref: a.asOf, mode: 'through' });
    assert.deepEqual(journalGroupBalanceIssues(journal), []);
    return sheet;
  };

  it('expenses larger than the cash drawer stay balanced (drawer shows minus + warning, not hidden)', () => {
    const s = check({ txs: [sale()], exps: [expense({ amount: 200_000, created_at: '2026-09-11T10:00:00.000Z' })] });
    assert.equal(s.undepositedCash, -100_000);
    assert.match(s.completeness.issues[0], /minus/);
  });
  it('a sale voided in the same month leaves no revenue, no cash and no bagi hasil', () => {
    const s = check({ txs: [sale({ is_void: true, status: 'Dibatalkan', voided_at: '2026-09-12T10:00:00.000Z' })] });
    assert.equal(s.undepositedCash, 0);
    assert.equal(s.yearProfit, 0);
    assert.equal(s.profitShare, 0);
  });
  it('void journal: each reversal is one balanced voucher', () => {
    const rows = buildJournal({ txs: [sale({ is_void: true, voided_at: '2026-09-12T10:00:00.000Z' })], mems: [], exps: [], books: [], ref: sep, mode: 'month' });
    assert.deepEqual(journalGroupBalanceIssues(rows), []);
  });
  it('sales before the books start date are not counted again (they are in the opening balance)', () => {
    const s = check({ txs: [sale({ created_at: '2025-12-20T10:00:00.000Z' })] });
    assert.equal(s.undepositedCash, 0);
    assert.equal(s.totalAssets, 10_000_000);
  });
  it('an asset bought before the books start enters at book value; accumulated depreciation matches the asset schedule', () => {
    const b = book({ openingCash: 4_000_000, openingCapital: 10_000_000, assets: [mesin('2025-01-01')] });
    const s = check({ books: [b] });
    // 12 bulan sebelum mulai (1.200.000) + Jan–Sep 2026 (900.000)
    assert.equal(s.accumDep, 2_100_000);
    assert.equal(s.fixedAtCost, 6_000_000);
    assert.equal(s.openingGap, -1_200_000, 'owner sees the opening difference instead of a silent imbalance');
  });
  it('bagi hasil: accrued monthly like the P&L, stays a liability after the year changes', () => {
    const b = book({ booksStart: '2025-06-01' });
    const tx = sale({ amount: 1_000_000, created_at: '2025-11-10T10:00:00.000Z', deposited_at: '2025-11-11T10:00:00.000Z' });
    const dec = check({ books: [b], txs: [tx], asOf: { year: 2025, month: 11 } });
    const jan = check({ books: [b], txs: [tx], asOf: { year: 2026, month: 0 } });
    assert.equal(dec.profitShare, 200_000);
    assert.equal(jan.profitShare, 200_000, 'unpaid bagi hasil does not vanish into equity on 1 January');
    assert.equal(jan.retainedPrior, 800_000);
    assert.equal(jan.yearProfit, 0);
  });
  it('bagi hasil uses the outlet percentage and a month with a loss has none', () => {
    const b = book();
    const s = check({
      books: [b],
      txs: [sale({ amount: 1_000_000, created_at: '2026-08-10T10:00:00.000Z' })],
      exps: [expense({ amount: 1_500_000, created_at: '2026-09-10T10:00:00.000Z' })]
    });
    assert.equal(s.profitShare, 200_000, 'August profit 1.000.000 × 20%; September loss has no negative share');
    const custom = buildBalanceSheet({ txs: [sale({ amount: 1_000_000 })], mems: [], exps: [], books: [b], asOf: sep, rates: { o1: 30 } });
    assert.equal(custom.profitShare, 300_000);
  });
  it('prive: account detail and ledger summary show the same (debit) balance', () => {
    const b = book({ drawings: [{ id: 'p', date: '2026-09-02', amount: 500_000, note: '' }] });
    const args = { txs: [], mems: [], exps: [], books: [b], asOf: sep };
    const detail = buildLedgerAccount({ ...args, account: `${BS.DRAWING.code} ${BS.DRAWING.label}` });
    const row = buildLedger(args).find((r) => r.name.startsWith(BS.DRAWING.code));
    assert.equal(detail.closing, 500_000);
    assert.equal(row?.saldo, 500_000);
    check({ books: [b] });
  });
  it('capital, prive, membership, QRIS clearing and books without a start date all balance', () => {
    check({ books: [book({ extraCapital: [{ id: 'c', date: '2026-09-01', amount: 1_000_000, note: '' }] })] });
    check({ mems: [{ id: 'm', outlet_id: 'o1', price: 50_000, created_at: '2026-09-05T10:00:00.000Z' }] });
    check({ txs: [sale({ payment_method: 'QRIS', paid_via: 'GATEWAY', paid_at: '2026-09-10T11:00:00.000Z' })] });
    check({ books: [], txs: [sale()] });
    check({ books: [book({ booksStart: '', assets: [mesin('2026-03-01')] })] });
  });
  it('equity statement for one month: before/after bagi hasil', () => {
    const e = buildEquity({ txs: [sale({ amount: 1_000_000 })], mems: [], exps: [], books: [book()], ref: sep });
    assert.equal(e.periodProfit, 1_000_000);
    assert.equal(e.periodProfitAfterShare, 800_000);
    assert.equal(e.endingEquity, e.openingEquity + e.additional + e.periodProfitAfterShare - e.drawings);
  });
});
