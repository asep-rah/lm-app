import {
  PNL_COGS,
  PNL_OPEX,
  PNL_REVENUE,
  type PnlMonthRef
} from '@/lib/pnlReport';
import {
  accumDepreciation,
  assetCostOf,
  assetSchedule,
  booksOf,
  FA_GROUPS,
  mapAssetGroup,
  monthDepreciation,
  openingGap,
  resolvedOpeningCash,
  type OutletBook
} from '@/lib/outletBooks';
import { PNL_PROFIT_SHARE_RATE, shareRateOf } from '@/lib/pnlReport';
import {
  cashDepositDateIso,
  collectionAssetBucket,
  collectionDateIso,
  financePayKind,
  missingPaidAtWhilePaid,
  saleAssetBucket,
  voidDateIso
} from '@/lib/financeRecognition';
import { isVoidTransaction } from '@/lib/voidTx';

export const BS = {
  CASH: { code: '110001', label: 'Rekening Bank Outlet / Omset' },
  AR: { code: '110002', label: 'Piutang Usaha' },
  OCA: { code: '110003', label: 'Aset Lancar Lainnya' },
  CLEARING: { code: '110004', label: 'QRIS / Gateway Clearing' },
  UNDEPOSITED: { code: '110005', label: 'Kas Tunai Belum Disetor' },
  FA: { code: '150001', label: 'Aset Tetap' },
  ACCUM: { code: '150009', label: 'Akumulasi Penyusutan' },
  AP: { code: '210001', label: 'Utang Usaha' },
  BH: { code: '210010', label: 'Bagi Hasil Pengelolaan' },
  LT: { code: '220001', label: 'Utang Usaha Jangka Panjang' },
  LEASE: { code: '220002', label: 'Utang Sewa' },
  CAPITAL: { code: '310001', label: 'Modal' },
  DRAWING: { code: '310002', label: 'Prive' },
  RE: { code: '320001', label: 'Laba Ditahan' },
  OPENING_GAP: { code: '320009', label: 'Selisih Pembukaan' },
  DEP: { code: '600029', label: 'Penyusutan Aset' }
};

const assetAcc = (bucket: 'bank' | 'clearing' | 'receivable' | 'undeposited') => {
  if (bucket === 'clearing') return BS.CLEARING;
  if (bucket === 'receivable') return BS.AR;
  if (bucket === 'undeposited') return BS.UNDEPOSITED;
  return BS.CASH;
};

export type JournalLine = {
  date: string;
  akun: string;
  desc: string;
  debit: number;
  kredit: number;
  group: string;
  ref?: string;
  source?: string;
  outletId?: string | null;
  payStatus?: 'cash' | 'receivable' | 'clearing' | 'undeposited' | 'n/a';
};

export type LedgerRow = {
  name: string;
  debit: number;
  kredit: number;
  saldo: number;
};

export type LedgerMutation = {
  date: string;
  desc: string;
  ref: string;
  group: string;
  debit: number;
  kredit: number;
  balance: number;
  source?: string;
  payStatus?: JournalLine['payStatus'];
};

export type BooksCompleteness = {
  complete: boolean;
  verified: boolean;
  openingBalanced: boolean;
  openingGap: number;
  hasCapital: boolean;
  hasCashOrDerived: boolean;
  hasFixedAssets: boolean;
  hasBooksStart: boolean;
  issues: string[];
};

const acc = (code: string, label: string) => `${code} ${label}`;

const inMonth = (iso: string, ref: PnlMonthRef) => {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === ref.year && d.getMonth() === ref.month;
};

const onOrBefore = (iso: string, ref: PnlMonthRef) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() * 12 + d.getMonth() <= ref.year * 12 + ref.month;
};

const endOfMonthIso = (ref: PnlMonthRef) =>
  new Date(ref.year, ref.month + 1, 0, 12, 0, 0).toISOString();

const monthKey = (iso: string): PnlMonthRef | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() };
};

const eachMonth = (from: PnlMonthRef, to: PnlMonthRef): PnlMonthRef[] => {
  const out: PnlMonthRef[] = [];
  let y = from.year;
  let m = from.month;
  while (y * 12 + m <= to.year * 12 + to.month) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
};

const prevMonth = (ref: PnlMonthRef): PnlMonthRef =>
  ref.month === 0 ? { year: ref.year - 1, month: 11 } : { year: ref.year, month: ref.month - 1 };

/** Transaksi sebelum tanggal mulai pembukuan outlet tidak dihitung ulang (sudah di saldo awal). */
function afterBooksStart(iso: string, book: OutletBook | undefined) {
  if (!book?.booksStart) return true;
  const t = new Date(iso).getTime();
  const s = new Date(book.booksStart).getTime();
  if (Number.isNaN(t) || Number.isNaN(s)) return true;
  return t >= s;
}

function bookByOutlet(books: OutletBook[], outletId: string | null | undefined) {
  if (!outletId) return undefined;
  return books.find((b) => b.outletId === outletId);
}

export function assessBooksCompleteness(books: OutletBook[]): BooksCompleteness {
  if (!books.length) {
    return {
      complete: false,
      verified: false,
      openingBalanced: true,
      openingGap: 0,
      hasCapital: false,
      hasCashOrDerived: false,
      hasFixedAssets: false,
      hasBooksStart: false,
      issues: ['Pembukuan awal outlet belum diisi / belum dipilih.']
    };
  }
  const issues: string[] = [];
  let gapSum = 0;
  let hasCapital = false;
  let hasCashOrDerived = false;
  let hasFixedAssets = false;
  let hasBooksStart = false;
  let openingBalanced = true;
  books.forEach((b) => {
    const gap = openingGap(b);
    gapSum += gap;
    if (Math.abs(gap) > 0.5) {
      openingBalanced = false;
      issues.push(`Outlet ${b.outletId}: selisih pembukaan ${Math.round(gap)}.`);
    }
    if ((Number(b.openingCapital) || 0) > 0) hasCapital = true;
    if ((Number(b.openingCash) || 0) > 0 || resolvedOpeningCash(b) > 0) hasCashOrDerived = true;
    if (assetCostOf(b) > 0) hasFixedAssets = true;
    if (b.booksStart) hasBooksStart = true;
  });
  if (!hasCapital) issues.push('Modal awal masih Rp0 — belum diverifikasi.');
  if (!hasCashOrDerived && !hasFixedAssets) {
    issues.push('Kas/bank awal dan aset tetap masih kosong — neraca seimbang Rp0 belum berarti lengkap.');
  }
  if (!hasBooksStart) issues.push('Tanggal mulai pembukuan belum diisi.');
  const complete = hasCapital && hasBooksStart && openingBalanced && (hasCashOrDerived || hasFixedAssets);
  return {
    complete,
    verified: false,
    openingBalanced,
    openingGap: gapSum,
    hasCapital,
    hasCashOrDerived,
    hasFixedAssets,
    hasBooksStart,
    issues
  };
}

export function cashRevenueOf(txs: any[], mems: any[], through?: PnlMonthRef) {
  const ok = (iso: string) => (through ? onOrBefore(iso, through) : true);
  const tx = txs.filter((t) => ok(t.created_at)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const mem = mems.filter((m) => ok(m.created_at)).reduce((s, m) => s + (Number(m.price) || 0), 0);
  return tx + mem;
}

/**
 * Omset di rekening bank (bukan kas laci, bukan clearing).
 * Tunai hanya masuk di sini setelah deposited_at/settled_at.
 */
export function settledCashRevenueOf(txs: any[], mems: any[], through?: PnlMonthRef) {
  const end = through ? endOfMonthIso(through) : null;
  const before = (iso: string) => !end || new Date(iso).getTime() <= new Date(end).getTime();
  let tx = 0;
  txs.forEach((t) => {
    if (isVoidTransaction(t) && voidDateIso(t) && before(voidDateIso(t)!)) return;
    const amt = Number(t.amount) || 0;
    const dep = cashDepositDateIso(t);
    if (dep && before(dep)) tx += amt;
    else {
      const col = collectionDateIso(t);
      if (col && before(col) && collectionAssetBucket(t) === 'bank') tx += amt;
    }
  });
  // Membership dianggap setor bank pada created_at (kebijakan existing; belum ada laci member).
  const mem = mems
    .filter((m) => before(m.created_at))
    .reduce((s, m) => s + (Number(m.price) || 0), 0);
  return tx + mem;
}

export function undepositedCashRevenueOf(txs: any[], through?: PnlMonthRef) {
  const end = through ? endOfMonthIso(through) : null;
  const before = (iso: string) => !end || new Date(iso).getTime() <= new Date(end).getTime();
  return txs.reduce((s, t) => {
    if (isVoidTransaction(t) && voidDateIso(t) && before(voidDateIso(t)!)) return s;
    if (saleAssetBucket(t) !== 'undeposited') return s;
    if (!before(t.created_at)) return s;
    const dep = cashDepositDateIso(t);
    if (dep && before(dep)) return s;
    return s + (Number(t.amount) || 0);
  }, 0);
}

/** Omset non-tunai yang masih di piutang pada akhir through (belum ada jurnal koleksi bertanggal). */
export function receivableRevenueOf(txs: any[], through?: PnlMonthRef) {
  const end = through ? endOfMonthIso(through) : null;
  const before = (iso: string) => !end || new Date(iso).getTime() <= new Date(end).getTime();
  return txs.reduce((s, t) => {
    if (isVoidTransaction(t) && voidDateIso(t) && before(voidDateIso(t)!)) return s;
    if (saleAssetBucket(t) !== 'receivable') return s;
    if (!before(t.created_at)) return s;
    const col = collectionDateIso(t);
    if (col && before(col)) return s;
    return s + (Number(t.amount) || 0);
  }, 0);
}

/** Omset di clearing gateway pada akhir through. */
export function clearingRevenueOf(txs: any[], through?: PnlMonthRef) {
  const end = through ? endOfMonthIso(through) : null;
  const before = (iso: string) => !end || new Date(iso).getTime() <= new Date(end).getTime();
  return txs.reduce((s, t) => {
    if (isVoidTransaction(t) && voidDateIso(t) && before(voidDateIso(t)!)) return s;
    const col = collectionDateIso(t);
    if (!col || !before(col)) return s;
    if (collectionAssetBucket(t) !== 'clearing') return s;
    return s + (Number(t.amount) || 0);
  }, 0);
}

export function countMissingPaidAt(txs: any[]): number {
  return (txs || []).filter((t) => missingPaidAtWhilePaid(t)).length;
}

export function cashExpenseOf(exps: any[], through?: PnlMonthRef) {
  const ok = (iso: string) => (through ? onOrBefore(iso, through) : true);
  return exps.filter((e) => ok(e.created_at)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

export function periodRevenue(txs: any[], mems: any[], ref: PnlMonthRef) {
  return cashRevenueOf(
    txs.filter((t) => inMonth(t.created_at, ref)),
    mems.filter((m) => inMonth(m.created_at, ref))
  );
}

export function periodExpense(exps: any[], ref: PnlMonthRef) {
  return cashExpenseOf(exps.filter((e) => inMonth(e.created_at, ref)));
}

function line(
  date: string,
  akun: string,
  desc: string,
  debit: number,
  kredit: number,
  group: string,
  meta?: Partial<Pick<JournalLine, 'ref' | 'source' | 'outletId' | 'payStatus'>>
): JournalLine | null {
  if (!(debit > 0 || kredit > 0)) return null;
  return {
    date,
    akun,
    desc,
    debit,
    kredit,
    group,
    ref: meta?.ref,
    source: meta?.source,
    outletId: meta?.outletId,
    payStatus: meta?.payStatus
  };
}

function openingLines(book: OutletBook): JournalLine[] {
  const start = book.booksStart || book.assets[0]?.acquiredAt;
  const date = start ? new Date(start).toISOString() : new Date().toISOString();
  const cash = resolvedOpeningCash(book);
  const fa = assetCostOf(book);
  const capital = Number(book.openingCapital) || 0;
  const ar = Number(book.receivables) || 0;
  const oca = Number(book.otherCurrentAssets) || 0;
  const ap = Number(book.tradePayables) || 0;
  const lt = Number(book.longTermPayables) || 0;
  const lease = Number(book.leasePayables) || 0;
  const gap = openingGap(book);
  const g = `open-${book.outletId}`;
  const desc = 'Saldo awal pembukuan outlet';
  const meta = { ref: g, source: 'opening', outletId: book.outletId, payStatus: 'n/a' as const };
  return [
    line(date, acc(BS.CASH.code, BS.CASH.label), desc, cash, 0, g, meta),
    line(date, acc(BS.AR.code, BS.AR.label), desc, ar, 0, g, meta),
    line(date, acc(BS.OCA.code, BS.OCA.label), desc, oca, 0, g, meta),
    line(date, acc(BS.FA.code, BS.FA.label), desc, fa, 0, g, meta),
    line(date, acc(BS.CAPITAL.code, BS.CAPITAL.label), desc, 0, capital, g, meta),
    line(date, acc(BS.AP.code, BS.AP.label), desc, 0, ap, g, meta),
    line(date, acc(BS.LT.code, BS.LT.label), desc, 0, lt, g, meta),
    line(date, acc(BS.LEASE.code, BS.LEASE.label), desc, 0, lease, g, meta),
    gap > 0.5
      ? line(date, acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label), 'Selisih pembukaan', 0, gap, g, meta)
      : gap < -0.5
        ? line(date, acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label), 'Selisih pembukaan', Math.abs(gap), 0, g, meta)
        : null
  ].filter((r): r is JournalLine => Boolean(r));
}

function depLine(book: OutletBook, ref: PnlMonthRef): JournalLine[] {
  const dep = monthDepreciation(book, ref);
  if (dep <= 0) return [];
  const date = endOfMonthIso(ref);
  const desc = 'Penyusutan aset tetap (garis lurus)';
  const g = `dep-${book.outletId}-${ref.year}-${ref.month}`;
  const meta = { ref: g, source: 'depreciation', outletId: book.outletId, payStatus: 'n/a' as const };
  return [
    line(date, acc(BS.DEP.code, BS.DEP.label), desc, dep, 0, g, meta),
    line(date, acc(BS.ACCUM.code, BS.ACCUM.label), desc, 0, dep, g, meta)
  ].filter((r): r is JournalLine => Boolean(r));
}

function pushSalePair(
  rows: JournalLine[],
  opts: {
    date: string;
    amount: number;
    revCode: string;
    revLabel: string;
    desc: string;
    group: string;
    outletId?: string | null;
    assetBucket: 'bank' | 'clearing' | 'receivable';
    ref: string;
    source: string;
  }
) {
  if (opts.amount <= 0) return;
  const asset = assetAcc(opts.assetBucket);
  const payStatus =
    opts.assetBucket === 'bank'
      ? ('cash' as const)
      : opts.assetBucket === 'clearing'
        ? ('clearing' as const)
        : opts.assetBucket === 'undeposited'
          ? ('undeposited' as const)
          : ('receivable' as const);
  const meta = {
    ref: opts.ref,
    source: opts.source,
    outletId: opts.outletId,
    payStatus
  };
  rows.push(
    line(opts.date, acc(asset.code, asset.label), opts.desc, opts.amount, 0, opts.group, meta)!,
    line(opts.date, acc(opts.revCode, opts.revLabel), opts.desc, 0, opts.amount, opts.group, meta)!
  );
}

function pushCollection(
  rows: JournalLine[],
  opts: {
    date: string;
    amount: number;
    desc: string;
    group: string;
    outletId?: string | null;
    assetBucket: 'bank' | 'clearing';
    ref: string;
  }
) {
  if (opts.amount <= 0) return;
  const asset = assetAcc(opts.assetBucket);
  const payStatus = opts.assetBucket === 'bank' ? ('cash' as const) : ('clearing' as const);
  const meta = {
    ref: opts.ref,
    source: 'collection',
    outletId: opts.outletId,
    payStatus
  };
  rows.push(
    line(opts.date, acc(asset.code, asset.label), opts.desc, opts.amount, 0, opts.group, meta)!,
    line(opts.date, acc(BS.AR.code, BS.AR.label), opts.desc, 0, opts.amount, opts.group, meta)!
  );
}

function pushCashDeposit(
  rows: JournalLine[],
  opts: { date: string; amount: number; desc: string; group: string; outletId?: string | null; ref: string }
) {
  if (opts.amount <= 0) return;
  const meta = { ref: opts.ref, source: 'deposit', outletId: opts.outletId, payStatus: 'cash' as const };
  rows.push(
    line(opts.date, acc(BS.CASH.code, BS.CASH.label), opts.desc, opts.amount, 0, opts.group, meta)!,
    line(opts.date, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), opts.desc, 0, opts.amount, opts.group, meta)!
  );
}

/** Pembalikan bertanggal: tukar debit↔kredit baris sumber pada voided_at. */
function pushReversal(
  rows: JournalLine[],
  sources: JournalLine[],
  voidAt: string,
  groupSuffix: string
) {
  sources.forEach((s, i) => {
    rows.push(
      line(
        voidAt,
        s.akun,
        `VOID · ${s.desc}`,
        s.kredit,
        s.debit,
        `${s.group}${groupSuffix}-${i}`,
        { ref: s.ref, source: 'void', outletId: s.outletId, payStatus: 'n/a' }
      )!
    );
  });
}

export function buildJournal(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  ref: PnlMonthRef;
  mode: 'month' | 'through';
}): JournalLine[] {
  const { txs, mems, exps, books, ref, mode } = opts;
  const keep = (iso: string) => (mode === 'month' ? inMonth(iso, ref) : onOrBefore(iso, ref));
  const rows: JournalLine[] = [];

  books.forEach((book) => {
    const startRef = monthKey(book.booksStart || book.assets[0]?.acquiredAt || '');
    if (startRef) {
      const includeOpening =
        mode === 'month' ? startRef.year === ref.year && startRef.month === ref.month : onOrBefore(book.booksStart || '', ref);
      if (includeOpening) rows.push(...openingLines(book));
      const from = startRef;
      const months = mode === 'month' ? [ref] : eachMonth(from, ref);
      months.forEach((m) => {
        if (m.year * 12 + m.month < from.year * 12 + from.month) return;
        if (mode === 'month' && (m.year !== ref.year || m.month !== ref.month)) return;
        rows.push(...depLine(book, m));
      });
    }
    book.extraCapital.forEach((mv) => {
      if (keep(mv.date) && mv.amount > 0) {
        const g = `cap-${mv.id}`;
        const desc = mv.note || 'Setoran modal';
        const meta = { ref: g, source: 'capital', outletId: book.outletId, payStatus: 'n/a' as const };
        rows.push(
          line(mv.date, acc(BS.CASH.code, BS.CASH.label), desc, mv.amount, 0, g, meta)!,
          line(mv.date, acc(BS.CAPITAL.code, BS.CAPITAL.label), desc, 0, mv.amount, g, meta)!
        );
      }
    });
    book.drawings.forEach((mv) => {
      if (keep(mv.date) && mv.amount > 0) {
        const g = `prv-${mv.id}`;
        const desc = mv.note || 'Prive';
        const meta = { ref: g, source: 'drawing', outletId: book.outletId, payStatus: 'n/a' as const };
        rows.push(
          line(mv.date, acc(BS.DRAWING.code, BS.DRAWING.label), desc, mv.amount, 0, g, meta)!,
          line(mv.date, acc(BS.CASH.code, BS.CASH.label), desc, 0, mv.amount, g, meta)!
        );
      }
    });
  });

  txs.forEach((t) => {
    const colAt = collectionDateIso(t);
    const depAt = cashDepositDateIso(t);
    const voidAt = voidDateIso(t);
    const relevantDates = [t.created_at, colAt, depAt, voidAt].filter(Boolean) as string[];
    if (!relevantDates.some((d) => keep(d))) return;

    const book = bookByOutlet(books, t.outlet_id);
    if (book && !afterBooksStart(t.created_at, book)) return;

    const amt = Number(t.amount) || 0;
    const fee = Number(t.delivery_fee) || 0;
    const laundry = Math.max(0, amt - fee);
    const rev = String(t.order_type || '').toLowerCase() === 'online' ? PNL_REVENUE[1] : PNL_REVENUE[0];
    const saleBucket = saleAssetBucket(t);
    const refId = String(t.receipt_number || t.id || '');
    const g = `tx-${t.id}`;
    const saleTag =
      saleBucket === 'undeposited' ? 'tunai-laci' : saleBucket === 'receivable' ? 'piutang' : saleBucket;
    const descSale = `${t.receipt_number || 'TRX'} · ${t.customer_name || '-'} · jual (${saleTag})`;

    const postedSale: JournalLine[] = [];
    const capture = (fn: () => void) => {
      const before = rows.length;
      fn();
      postedSale.push(...rows.slice(before));
    };

    if (keep(t.created_at)) {
      capture(() => {
        if (laundry > 0) {
          pushSalePair(rows, {
            date: t.created_at,
            amount: laundry,
            revCode: rev.code,
            revLabel: rev.label,
            desc: descSale,
            group: `${g}-l`,
            outletId: t.outlet_id,
            assetBucket: saleBucket,
            ref: refId,
            source: 'transaction'
          });
        }
        if (fee > 0) {
          pushSalePair(rows, {
            date: t.created_at,
            amount: fee,
            revCode: PNL_REVENUE[2].code,
            revLabel: PNL_REVENUE[2].label,
            desc: descSale,
            group: `${g}-f`,
            outletId: t.outlet_id,
            assetBucket: saleBucket,
            ref: refId,
            source: 'transaction'
          });
        }
        if (!laundry && !fee && amt > 0) {
          pushSalePair(rows, {
            date: t.created_at,
            amount: amt,
            revCode: rev.code,
            revLabel: rev.label,
            desc: descSale,
            group: g,
            outletId: t.outlet_id,
            assetBucket: saleBucket,
            ref: refId,
            source: 'transaction'
          });
        }
      });
    }

    const postedCol: JournalLine[] = [];
    if (colAt && keep(colAt) && saleBucket === 'receivable') {
      const dest = collectionAssetBucket(t);
      if (dest === 'bank' || dest === 'clearing') {
        const colTag = dest === 'clearing' ? 'koleksi→clearing' : 'koleksi→bank';
        const descCol = `${t.receipt_number || 'TRX'} · ${t.customer_name || '-'} · ${colTag}`;
        const pieces: { amount: number; suffix: string }[] = [];
        if (laundry > 0) pieces.push({ amount: laundry, suffix: '-l' });
        if (fee > 0) pieces.push({ amount: fee, suffix: '-f' });
        if (!laundry && !fee && amt > 0) pieces.push({ amount: amt, suffix: '' });
        const before = rows.length;
        pieces.forEach((p) => {
          pushCollection(rows, {
            date: colAt,
            amount: p.amount,
            desc: descCol,
            group: `${g}-col${p.suffix}`,
            outletId: t.outlet_id,
            assetBucket: dest,
            ref: refId
          });
        });
        postedCol.push(...rows.slice(before));
      }
    }

    const postedDep: JournalLine[] = [];
    if (depAt && keep(depAt) && saleBucket === 'undeposited') {
      const descDep = `${t.receipt_number || 'TRX'} · setor kas → bank`;
      const before = rows.length;
      const pieces: { amount: number; suffix: string }[] = [];
      if (laundry > 0) pieces.push({ amount: laundry, suffix: '-l' });
      if (fee > 0) pieces.push({ amount: fee, suffix: '-f' });
      if (!laundry && !fee && amt > 0) pieces.push({ amount: amt, suffix: '' });
      pieces.forEach((p) => {
        pushCashDeposit(rows, {
          date: depAt,
          amount: p.amount,
          desc: descDep,
          group: `${g}-dep${p.suffix}`,
          outletId: t.outlet_id,
          ref: refId
        });
      });
      postedDep.push(...rows.slice(before));
    }

    if (voidAt && keep(voidAt)) {
      // Bangun ulang jejak sumber bila bulan void ≠ bulan jual (mode month).
      const src = [...postedSale, ...postedCol, ...postedDep];
      if (src.length) {
        pushReversal(rows, src, voidAt, '-void');
      } else {
        // Void di bulan ini tetapi jual di bulan lain: posting jual+koleksi+deposit through void lalu reverse
        // hanya komponen yang tanggalnya <= voidAt (sudah di through). Untuk mode month: buat mini through.
        const ghost: JournalLine[] = [];
        const pushGhostSale = () => {
          const bucket = saleAssetBucket(t);
          const parts: { amount: number; code: string; label: string; suffix: string }[] = [];
          if (laundry > 0) parts.push({ amount: laundry, code: rev.code, label: rev.label, suffix: '-l' });
          if (fee > 0) {
            parts.push({
              amount: fee,
              code: PNL_REVENUE[2].code,
              label: PNL_REVENUE[2].label,
              suffix: '-f'
            });
          }
          if (!laundry && !fee && amt > 0) parts.push({ amount: amt, code: rev.code, label: rev.label, suffix: '' });
          parts.forEach((p) => {
            const a = assetAcc(bucket);
            ghost.push(
              {
                date: t.created_at,
                akun: acc(a.code, a.label),
                desc: descSale,
                debit: p.amount,
                kredit: 0,
                group: `${g}${p.suffix}`,
                ref: refId,
                source: 'transaction',
                outletId: t.outlet_id
              },
              {
                date: t.created_at,
                akun: acc(p.code, p.label),
                desc: descSale,
                debit: 0,
                kredit: p.amount,
                group: `${g}${p.suffix}`,
                ref: refId,
                source: 'transaction',
                outletId: t.outlet_id
              }
            );
          });
        };
        pushGhostSale();
        if (colAt) {
          const dest = collectionAssetBucket(t);
          if (dest === 'bank' || dest === 'clearing') {
            const a = assetAcc(dest);
            ghost.push(
              {
                date: colAt,
                akun: acc(a.code, a.label),
                desc: 'koleksi',
                debit: amt,
                kredit: 0,
                group: `${g}-col`,
                ref: refId,
                source: 'collection',
                outletId: t.outlet_id
              },
              {
                date: colAt,
                akun: acc(BS.AR.code, BS.AR.label),
                desc: 'koleksi',
                debit: 0,
                kredit: amt,
                group: `${g}-col`,
                ref: refId,
                source: 'collection',
                outletId: t.outlet_id
              }
            );
          }
        }
        if (depAt) {
          ghost.push(
            {
              date: depAt,
              akun: acc(BS.CASH.code, BS.CASH.label),
              desc: 'setor',
              debit: amt,
              kredit: 0,
              group: `${g}-dep`,
              ref: refId,
              source: 'deposit',
              outletId: t.outlet_id
            },
            {
              date: depAt,
              akun: acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label),
              desc: 'setor',
              debit: 0,
              kredit: amt,
              group: `${g}-dep`,
              ref: refId,
              source: 'deposit',
              outletId: t.outlet_id
            }
          );
        }
        pushReversal(rows, ghost, voidAt, '-void');
      }
    }
  });

  mems.forEach((m) => {
    if (!keep(m.created_at)) return;
    const book = bookByOutlet(books, m.outlet_id);
    if (book && !afterBooksStart(m.created_at, book)) return;
    const amt = Number(m.price) || 0;
    if (amt <= 0) return;
    const desc = m.package_name || 'Member';
    const g = `mem-${m.id}`;
    const meta = {
      ref: String(m.id || g),
      source: 'membership',
      outletId: m.outlet_id,
      payStatus: 'cash' as const
    };
    rows.push(
      line(m.created_at, acc(BS.CASH.code, BS.CASH.label), desc, amt, 0, g, meta)!,
      line(m.created_at, acc(PNL_REVENUE[3].code, PNL_REVENUE[3].label), desc, 0, amt, g, meta)!
    );
  });

  exps.forEach((e) => {
    if (!keep(e.created_at)) return;
    const book = bookByOutlet(books, e.outlet_id);
    if (book && !afterBooksStart(e.created_at, book)) return;
    const amt = Number(e.amount) || 0;
    if (amt <= 0) return;
    const akun = String(e.category || 'Beban');
    const desc = e.description || '-';
    const g = `exp-${e.id}`;
    const meta = {
      ref: String(e.id || g),
      source: 'expense',
      outletId: e.outlet_id,
      payStatus: 'n/a' as const
    };
    rows.push(
      line(e.created_at, akun, desc, amt, 0, g, meta)!,
      line(e.created_at, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), desc, 0, amt, g, meta)!
    );
  });

  return rows
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Cek setiap nomor bukti (group) seimbang debit=kredit. */
export function journalGroupBalanceIssues(rows: JournalLine[]): { group: string; debit: number; kredit: number }[] {
  const map: Record<string, { debit: number; kredit: number }> = {};
  rows.forEach((r) => {
    if (!map[r.group]) map[r.group] = { debit: 0, kredit: 0 };
    map[r.group].debit += r.debit;
    map[r.group].kredit += r.kredit;
  });
  return Object.entries(map)
    .filter(([, v]) => Math.abs(v.debit - v.kredit) > 0.5)
    .map(([group, v]) => ({ group, ...v }));
}

export function buildLedger(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  asOf: PnlMonthRef;
}): LedgerRow[] {
  const journal = buildJournal({ ...opts, ref: opts.asOf, mode: 'through' });
  const map: Record<string, { debit: number; kredit: number }> = {};
  const add = (name: string, debit: number, kredit: number) => {
    if (!map[name]) map[name] = { debit: 0, kredit: 0 };
    map[name].debit += debit;
    map[name].kredit += kredit;
  };
  [BS.CASH, BS.AR, BS.CLEARING, BS.UNDEPOSITED, BS.OCA, BS.FA, BS.ACCUM, BS.AP, BS.BH, BS.LT, BS.LEASE, BS.CAPITAL, BS.DRAWING, BS.DEP].forEach((a) =>
    add(acc(a.code, a.label), 0, 0)
  );
  PNL_REVENUE.forEach((a) => add(acc(a.code, a.label), 0, 0));
  [...PNL_COGS, ...PNL_OPEX].forEach((a) => add(`${a.code} ${a.label}`, 0, 0));
  journal.forEach((r) => add(r.akun, r.debit, r.kredit));

  const creditNormal = new Set([
    acc(BS.ACCUM.code, BS.ACCUM.label),
    acc(BS.AP.code, BS.AP.label),
    acc(BS.BH.code, BS.BH.label),
    acc(BS.LT.code, BS.LT.label),
    acc(BS.LEASE.code, BS.LEASE.label),
    acc(BS.CAPITAL.code, BS.CAPITAL.label),
    acc(BS.RE.code, BS.RE.label),
    acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label),
    ...PNL_REVENUE.map((a) => acc(a.code, a.label))
  ]);

  return Object.entries(map)
    .map(([name, v]) => ({
      name,
      ...v,
      saldo: creditNormal.has(name) || /^400/.test(name) ? v.kredit - v.debit : v.debit - v.kredit
    }))
    .filter((r) => r.debit || r.kredit)
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export function buildLedgerAccount(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  asOf: PnlMonthRef;
  account: string;
}): { account: string; opening: number; mutations: LedgerMutation[]; closing: number } {
  const journal = buildJournal({ ...opts, ref: opts.asOf, mode: 'through' })
    .filter((r) => r.akun === opts.account)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const creditNormal =
    opts.account.startsWith('400') ||
    opts.account.startsWith('2') ||
    opts.account.startsWith('3') ||
    opts.account.includes(BS.ACCUM.code) ||
    opts.account.includes(BS.OPENING_GAP.code);

  let balance = 0;
  const mutations: LedgerMutation[] = journal.map((r) => {
    balance += creditNormal ? r.kredit - r.debit : r.debit - r.kredit;
    return {
      date: r.date,
      desc: r.desc,
      ref: r.ref || r.group,
      group: r.group,
      debit: r.debit,
      kredit: r.kredit,
      balance,
      source: r.source,
      payStatus: r.payStatus
    };
  });

  return {
    account: opts.account,
    opening: 0,
    mutations,
    closing: balance
  };
}

export type EquityStatement = {
  openingCapital: number;
  priorRetained: number;
  openingEquity: number;
  additional: number;
  /** Laba rugi bulan berjalan sebelum bagi hasil. */
  periodProfit: number;
  /** Laba rugi bulan berjalan setelah bagi hasil. */
  periodProfitAfterShare: number;
  drawings: number;
  endingEquity: number;
};

function depThrough(books: OutletBook[], through: PnlMonthRef) {
  return books.reduce((s, b) => {
    const start = monthKey(b.booksStart || b.assets[0]?.acquiredAt || '');
    if (!start) return s + accumDepreciation(b, through);
    return s + eachMonth(start, through).reduce((n, m) => n + monthDepreciation(b, m), 0);
  }, 0);
}

export function buildEquity(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  ref: PnlMonthRef;
  rates?: Record<string, number>;
}): EquityStatement {
  const { txs, mems, exps, books, ref, rates } = opts;
  const prior = prevMonth(ref);
  const openingCapital = books.reduce((s, b) => s + (Number(b.openingCapital) || 0), 0);
  const extraThrough = (through: PnlMonthRef) =>
    books.reduce(
      (s, b) => s + b.extraCapital.filter((m) => onOrBefore(m.date, through)).reduce((n, m) => n + (Number(m.amount) || 0), 0),
      0
    );
  const drawThrough = (through: PnlMonthRef) =>
    books.reduce(
      (s, b) => s + b.drawings.filter((m) => onOrBefore(m.date, through)).reduce((n, m) => n + (Number(m.amount) || 0), 0),
      0
    );

  const extraPrior = extraThrough(prior);
  const drawPrior = drawThrough(prior);
  const extraPeriod = extraThrough(ref) - extraPrior;
  const drawPeriod = drawThrough(ref) - drawPrior;

  const priorRetained = cashRevenueOf(txs, mems, prior) - cashExpenseOf(exps, prior) - depThrough(books, prior);
  const periodProfit =
    periodRevenue(txs, mems, ref) -
    periodExpense(exps, ref) -
    books.reduce((s, b) => s + monthDepreciation(b, ref), 0);

  let periodShare = 0;
  if (!books.length) {
    periodShare = periodProfit > 0 ? Math.round(periodProfit * PNL_PROFIT_SHARE_RATE) : 0;
  } else {
    periodShare = books.reduce((s, book) => {
      const id = book.outletId;
      const scopedTx = txs.filter((t) => (!id || t.outlet_id === id) && inMonth(t.created_at, ref));
      const scopedMem = mems.filter((m) => (!id || m.outlet_id === id) && inMonth(m.created_at, ref));
      const scopedExp = exps.filter((e) => (!id || e.outlet_id === id) && inMonth(e.created_at, ref));
      const laba =
        periodRevenue(scopedTx, scopedMem, ref) -
        periodExpense(scopedExp, ref) -
        monthDepreciation(book, ref);
      const rate = id ? shareRateOf(rates, id) : PNL_PROFIT_SHARE_RATE;
      return s + (laba > 0 ? Math.round(laba * rate) : 0);
    }, 0);
  }

  const openingEquity = openingCapital + extraPrior - drawPrior + priorRetained;
  const periodProfitAfterShare = periodProfit - periodShare;
  return {
    openingCapital,
    priorRetained,
    openingEquity,
    additional: extraPeriod,
    periodProfit,
    periodProfitAfterShare,
    drawings: drawPeriod,
    endingEquity: openingEquity + extraPeriod + periodProfitAfterShare - drawPeriod
  };
}

export type FaGroupRow = { key: string; label: string; short: string; cost: number; accum: number };

export type BalanceSheet = {
  cash: number;
  undepositedCash: number;
  receivables: number;
  tradeReceivablesFromSales: number;
  gatewayClearing: number;
  otherCurrent: number;
  currentAssets: number;
  faGroups: FaGroupRow[];
  fixedAtCost: number;
  accumDep: number;
  netFixed: number;
  nonCurrent: number;
  totalAssets: number;
  tradePayables: number;
  profitShare: number;
  shortLiab: number;
  longTermPayables: number;
  leasePayables: number;
  longLiab: number;
  totalLiab: number;
  paidInCapital: number;
  equityBegin: number;
  yearProfit: number;
  extraYear: number;
  drawingsYear: number;
  drawings: number;
  retained: number;
  openingGap: number;
  totalEquity: number;
  totalPasiva: number;
  assets: { name: string; category: string; cost: number; accum: number; book: number; remainingMonths: number }[];
  completeness: BooksCompleteness;
};

const priorYearEnd = (asOf: PnlMonthRef): PnlMonthRef => ({ year: asOf.year - 1, month: 11 });

const inYearThrough = (iso: string, asOf: PnlMonthRef) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === asOf.year && d.getFullYear() * 12 + d.getMonth() <= asOf.year * 12 + asOf.month;
};

function ytdDep(books: OutletBook[], asOf: PnlMonthRef) {
  const start: PnlMonthRef = { year: asOf.year, month: 0 };
  return books.reduce((s, b) => s + eachMonth(start, asOf).reduce((n, m) => n + monthDepreciation(b, m), 0), 0);
}

function profitShareYtd(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  asOf: PnlMonthRef;
  rates?: Record<string, number>;
}) {
  const { txs, mems, exps, books, asOf, rates } = opts;
  if (!books.length) {
    const laba =
      cashRevenueOf(
        txs.filter((t) => inYearThrough(t.created_at, asOf)),
        mems.filter((m) => inYearThrough(m.created_at, asOf))
      ) -
      cashExpenseOf(exps.filter((e) => inYearThrough(e.created_at, asOf))) -
      ytdDep([], asOf);
    return laba > 0 ? Math.round(laba * PNL_PROFIT_SHARE_RATE) : 0;
  }
  return books.reduce((s, book) => {
    const id = book.outletId;
    const scopedTx = txs.filter((t) => (!id || t.outlet_id === id) && inYearThrough(t.created_at, asOf));
    const scopedMem = mems.filter((m) => (!id || m.outlet_id === id) && inYearThrough(m.created_at, asOf));
    const scopedExp = exps.filter((e) => (!id || e.outlet_id === id) && inYearThrough(e.created_at, asOf));
    const laba =
      cashRevenueOf(scopedTx, scopedMem) -
      cashExpenseOf(scopedExp) -
      eachMonth({ year: asOf.year, month: 0 }, asOf).reduce((n, m) => n + monthDepreciation(book, m), 0);
    const rate = id ? shareRateOf(rates, id) : PNL_PROFIT_SHARE_RATE;
    return s + (laba > 0 ? Math.round(laba * rate) : 0);
  }, 0);
}

export function buildBalanceSheet(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  asOf: PnlMonthRef;
  rates?: Record<string, number>;
}): BalanceSheet {
  const { txs, mems, exps, books, asOf, rates } = opts;
  const prior = priorYearEnd(asOf);
  const cashOpen = books.reduce((s, b) => s + resolvedOpeningCash(b), 0);
  const extraAll = books.reduce(
    (s, b) => s + b.extraCapital.filter((m) => onOrBefore(m.date, asOf)).reduce((n, m) => n + (Number(m.amount) || 0), 0),
    0
  );
  const extraPrior = books.reduce(
    (s, b) => s + b.extraCapital.filter((m) => onOrBefore(m.date, prior)).reduce((n, m) => n + (Number(m.amount) || 0), 0),
    0
  );
  const extraYear = extraAll - extraPrior;
  const drawAll = books.reduce(
    (s, b) => s + b.drawings.filter((m) => onOrBefore(m.date, asOf)).reduce((n, m) => n + (Number(m.amount) || 0), 0),
    0
  );
  const drawPrior = books.reduce(
    (s, b) => s + b.drawings.filter((m) => onOrBefore(m.date, prior)).reduce((n, m) => n + (Number(m.amount) || 0), 0),
    0
  );
  const drawingsYear = drawAll - drawPrior;
  const revenue = cashRevenueOf(txs, mems, asOf);
  const settledRevenue = settledCashRevenueOf(txs, mems, asOf);
  const salesAR = receivableRevenueOf(txs, asOf);
  const gatewayClearing = clearingRevenueOf(txs, asOf);
  const expense = cashExpenseOf(exps, asOf);
  const undepositedCash = Math.max(0, undepositedCashRevenueOf(txs, asOf) - expense);
  const revPrior = cashRevenueOf(txs, mems, prior);
  const expPrior = cashExpenseOf(exps, prior);
  const depAll = books.reduce((s, b) => s + accumDepreciation(b, asOf), 0);
  const depPrior = depThrough(books, prior);
  // Bank = pembukaan rekening + setoran modal − prive + omset yang sudah di rekening (bukan laci)
  const cash = cashOpen + extraAll + settledRevenue - drawAll;
  const openingAR = books.reduce((s, b) => s + (Number(b.receivables) || 0), 0);
  const tradeReceivablesFromSales = salesAR;
  const receivables = openingAR + tradeReceivablesFromSales;
  const otherCurrent = books.reduce((s, b) => s + (Number(b.otherCurrentAssets) || 0), 0);
  const currentAssets = cash + undepositedCash + receivables + gatewayClearing + otherCurrent;

  const assets = books.flatMap((b) =>
    (b.assets || [])
      .filter((a) => (Number(a.cost) || 0) > 0)
      .map((a) => {
        const sch = assetSchedule(a, asOf);
        const group = mapAssetGroup(a.category);
        return {
          name: a.name || 'Aset',
          category: group.label,
          cost: Number(a.cost) || 0,
          accum: sch.accum,
          book: sch.bookValue,
          remainingMonths: Math.max(0, sch.life - sch.charged)
        };
      })
  );

  const faGroups: FaGroupRow[] = FA_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    short: g.short,
    cost: assets.filter((a) => mapAssetGroup(a.category).key === g.key).reduce((s, a) => s + a.cost, 0),
    accum: assets.filter((a) => mapAssetGroup(a.category).key === g.key).reduce((s, a) => s + a.accum, 0)
  }));

  const fixedAtCost = faGroups.reduce((s, g) => s + g.cost, 0);
  const accumDep = faGroups.reduce((s, g) => s + g.accum, 0);
  const netFixed = fixedAtCost - accumDep;
  const nonCurrent = netFixed;
  const totalAssets = currentAssets + nonCurrent;

  const tradePayables = books.reduce((s, b) => s + (Number(b.tradePayables) || 0), 0);
  const longTermPayables = books.reduce((s, b) => s + (Number(b.longTermPayables) || 0), 0);
  const leasePayables = books.reduce((s, b) => s + (Number(b.leasePayables) || 0), 0);
  const ytdRev = cashRevenueOf(
    txs.filter((t) => inYearThrough(t.created_at, asOf)),
    mems.filter((m) => inYearThrough(m.created_at, asOf))
  );
  const ytdExp = cashExpenseOf(exps.filter((e) => inYearThrough(e.created_at, asOf)));
  const ytdDepAmt = ytdDep(books, asOf);
  const profitShare = profitShareYtd({ txs, mems, exps, books, asOf, rates });
  const yearProfit = ytdRev - ytdExp - ytdDepAmt - profitShare;
  const shortLiab = tradePayables + profitShare;
  const longLiab = longTermPayables + leasePayables;
  const totalLiab = shortLiab + longLiab;

  const paidInCapital = books.reduce((s, b) => s + (Number(b.openingCapital) || 0), 0) + extraAll;
  const gap = books.reduce((s, b) => s + openingGap(b), 0);
  const retainedPrior = revPrior - expPrior - depPrior;
  const equityBegin =
    books.reduce((s, b) => s + (Number(b.openingCapital) || 0), 0) + extraPrior - drawPrior + retainedPrior + gap;
  const totalEquity = equityBegin + extraYear + yearProfit - drawingsYear;
  const totalPasiva = totalLiab + totalEquity;

  return {
    cash,
    undepositedCash,
    receivables,
    tradeReceivablesFromSales,
    gatewayClearing,
    otherCurrent,
    currentAssets,
    faGroups,
    fixedAtCost,
    accumDep,
    netFixed,
    nonCurrent,
    totalAssets,
    tradePayables,
    profitShare,
    shortLiab,
    longTermPayables,
    leasePayables,
    longLiab,
    totalLiab,
    paidInCapital,
    equityBegin,
    yearProfit,
    extraYear,
    drawingsYear,
    drawings: drawAll,
    retained: revenue - expense - depAll,
    openingGap: gap,
    totalEquity,
    totalPasiva,
    assets,
    completeness: assessBooksCompleteness(books)
  };
}

export { booksOf, financePayKind };
