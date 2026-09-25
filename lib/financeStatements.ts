import {
  buildPnlMonth,
  txRevenueParts,
  PNL_COGS,
  PNL_OPEX,
  PNL_REVENUE,
  type PnlMonthRef
} from '@/lib/pnlReport';
import {
  assetCostOf,
  assetSchedule,
  booksOf,
  FA_GROUPS,
  mapAssetGroup,
  monthDepreciation,
  openingAccumDep,
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
import { parseSplitLabel, paymentPartsOf } from '@/lib/paymentParts';

export const BS = {
  CASH: { code: '110001', label: 'Rekening Bank Outlet / Omset' },
  AR: { code: '110002', label: 'Piutang Usaha' },
  OCA: { code: '110003', label: 'Aset Lancar Lainnya' },
  CLEARING: { code: '110004', label: 'QRIS / Gateway Clearing' },
  UNDEPOSITED: { code: '110005', label: 'Kas Tunai Belum Disetor' },
  THR_FUND: { code: '110006', label: 'Dana Tabungan THR' },
  FA: { code: '150001', label: 'Aset Tetap' },
  ACCUM: { code: '150009', label: 'Akumulasi Penyusutan' },
  AP: { code: '210001', label: 'Utang Usaha' },
  BH: { code: '210010', label: 'Bagi Hasil Pengelolaan' },
  THR_PAYABLE: { code: '210011', label: 'Utang THR Crew' },
  LT: { code: '220001', label: 'Utang Usaha Jangka Panjang' },
  LEASE: { code: '220002', label: 'Utang Sewa' },
  CAPITAL: { code: '310001', label: 'Modal' },
  DRAWING: { code: '310002', label: 'Prive' },
  RE: { code: '320001', label: 'Laba Ditahan' },
  OPENING_GAP: { code: '320009', label: 'Selisih Pembukaan' },
  DEP: { code: '600029', label: 'Penyusutan Aset' }
};

/**
 * Akun beban lawan dari 210010 (bagi hasil pengelolaan yang terutang tiap bulan).
 * Hanya dipakai di jurnal / buku besar; format Laba Rugi tidak berubah
 * (di sana tetap baris "Bagi Hasil Pengelolaan").
 */
export const BH_EXPENSE = 'Beban Bagi Hasil Pengelolaan';

const BS_ACCOUNTS = [
  BS.CASH, BS.AR, BS.OCA, BS.CLEARING, BS.UNDEPOSITED, BS.THR_FUND, BS.FA, BS.ACCUM, BS.AP, BS.BH, BS.THR_PAYABLE,
  BS.LT, BS.LEASE, BS.CAPITAL, BS.DRAWING, BS.RE, BS.OPENING_GAP
];
const CREDIT_NORMAL_BS = [BS.ACCUM, BS.AP, BS.BH, BS.THR_PAYABLE, BS.LT, BS.LEASE, BS.CAPITAL, BS.RE, BS.OPENING_GAP];

/** Pengeluaran kategori "Tabungan THR": disisihkan untuk THR crew saat hari raya. */
export const isThrSavingCategory = (category: unknown) => /tabungan\s*thr/i.test(String(category || ''));

/** Pembayaran utang yang dicatat owner (/api/owner/finance-settlements). */
export type FinanceSettlement = {
  id: string;
  outlet_id: string | null;
  kind: 'profit_share' | 'thr';
  amount: number;
  paid_at: string;
  /** Sumber dana: rekening bank, kas laci, atau dana tabungan THR. */
  source: 'bank' | 'laci' | 'dana_thr';
  note?: string | null;
  voided_at?: string | null;
};

export const SETTLEMENT_SOURCES: Record<FinanceSettlement['source'], { code: string; label: string }> = {
  bank: BS.CASH,
  laci: BS.UNDEPOSITED,
  dana_thr: BS.THR_FUND
};

/** Setoran kas kasir (cash_deposits) yang sudah BALANCED — masuk lewat QRIS Mayar (clearing). */
const isBalancedCashDeposit = (row: any) => {
  const st = String(row?.status || '').toUpperCase();
  const qris = String(row?.status_qris || row?.qr_payment_status || '').toLowerCase();
  return st === 'BALANCED' || qris === 'success' || qris === 'paid';
};

/** Akun neraca (aset/liabilitas/ekuitas); selain ini = akun laba rugi. */
export const isBalanceSheetAccount = (name: string) => BS_ACCOUNTS.some((a) => name === `${a.code} ${a.label}`);
export const isRevenueAccount = (name: string) => /^400/.test(name);
/** Saldo normal kredit: pendapatan, liabilitas, ekuitas, akumulasi penyusutan. Prive & beban = debit. */
export const isCreditNormal = (name: string) =>
  isRevenueAccount(name) || CREDIT_NORMAL_BS.some((a) => name === `${a.code} ${a.label}`);

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
  const faAccum = openingAccumDep(book);
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
    // Aset dibeli sebelum mulai pembukuan: penyusutan yang sudah terjadi ikut saldo awal.
    line(date, acc(BS.ACCUM.code, BS.ACCUM.label), 'Akumulasi penyusutan sebelum mulai pembukuan', 0, faAccum, g, meta),
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
    assetBucket: 'bank' | 'clearing' | 'receivable' | 'undeposited';
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
  sources.forEach((s) => {
    rows.push(
      line(
        voidAt,
        s.akun,
        `VOID · ${s.desc}`,
        s.kredit,
        s.debit,
        `${s.group}${groupSuffix}`,
        { ref: s.ref, source: 'void', outletId: s.outletId, payStatus: 'n/a' }
      )!
    );
  });
}

/**
 * Semua jurnal satu transaksi, bertanggal:
 *  - jual (created_at): Cr pendapatan (tanpa bagian saldo deposit — sudah omset
 *    saat top up); Dr per cara bayar: tunai → 110005 laci, QRIS/transfer → 110002 piutang;
 *  - koleksi (paid_at/settled_at): bagian non-tunai 110002 → 110004 clearing / 110001 bank;
 *  - setor per transaksi (deposited_at/settled_at, data lama): bagian tunai 110005 → 110001.
 */
function transactionLines(t: any): JournalLine[] {
  const out: JournalLine[] = [];
  // Pembayaran tunggal: aturan lama tetap (belum lunas → piutang, bukan laci). Split: per bagian.
  const parts = parseSplitLabel(t.payment_method)
    ? paymentPartsOf(t)
    : paymentPartsOf(t).map((p) =>
        p.kind === 'deposit' ? p : { ...p, kind: saleAssetBucket(t) === 'receivable' ? ('noncash' as const) : ('cash' as const) }
      );
  const cashPart = parts.filter((p) => p.kind === 'cash').reduce((s, p) => s + p.amount, 0);
  const nonCashPart = parts.filter((p) => p.kind === 'noncash').reduce((s, p) => s + p.amount, 0);
  const { laundry, fee, online } = txRevenueParts(t);
  if (laundry + fee <= 0) return out;
  const rev = online ? PNL_REVENUE[1] : PNL_REVENUE[0];
  const refId = String(t.receipt_number || t.id || '');
  const g = `tx-${t.id}`;
  const who = `${t.receipt_number || 'TRX'} · ${t.customer_name || '-'}`;
  const tags = [cashPart ? 'tunai-laci' : '', nonCashPart ? 'piutang' : '', parts.some((p) => p.kind === 'deposit') ? 'sebagian saldo deposit' : '']
    .filter(Boolean)
    .join(' + ');
  const desc = `${who} · jual (${tags || 'deposit'})`;
  const meta = (payStatus: JournalLine['payStatus']) => ({ ref: refId, source: 'transaction', outletId: t.outlet_id, payStatus });
  const date = String(t.created_at);

  const debits: JournalLine[] = [
    line(date, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), desc, cashPart, 0, g, meta('undeposited')),
    line(date, acc(BS.AR.code, BS.AR.label), desc, nonCashPart, 0, g, meta('receivable'))
  ].filter((r): r is JournalLine => Boolean(r));
  const credits: JournalLine[] = [
    line(date, acc(rev.code, rev.label), desc, 0, laundry, g, meta('n/a')),
    line(date, acc(PNL_REVENUE[2].code, PNL_REVENUE[2].label), desc, 0, fee, g, meta('n/a'))
  ].filter((r): r is JournalLine => Boolean(r));
  out.push(...debits, ...credits);

  const colAt = collectionDateIso(t);
  if (colAt && nonCashPart > 0) {
    const dest = collectionAssetBucket(t) === 'bank' ? BS.CASH : BS.CLEARING;
    const d = `${who} · koleksi→${dest === BS.CASH ? 'bank' : 'clearing'}`;
    const m = { ref: refId, source: 'collection', outletId: t.outlet_id, payStatus: (dest === BS.CASH ? 'cash' : 'clearing') as JournalLine['payStatus'] };
    out.push(
      line(colAt, acc(dest.code, dest.label), d, nonCashPart, 0, `${g}-col`, m)!,
      line(colAt, acc(BS.AR.code, BS.AR.label), d, 0, nonCashPart, `${g}-col`, m)!
    );
  }
  const depAt = cashDepositDateIso(t);
  if (depAt && cashPart > 0) {
    const d = `${t.receipt_number || 'TRX'} · setor kas → bank`;
    const m = { ref: refId, source: 'deposit', outletId: t.outlet_id, payStatus: 'cash' as const };
    out.push(
      line(depAt, acc(BS.CASH.code, BS.CASH.label), d, cashPart, 0, `${g}-dep`, m)!,
      line(depAt, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), d, 0, cashPart, `${g}-dep`, m)!
    );
  }
  return out;
}

export function buildJournal(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  ref: PnlMonthRef;
  mode: 'month' | 'through';
  /** Persentase bagi hasil per outlet (pengaturan owner); tanpa ini dipakai 20%. */
  rates?: Record<string, number>;
  /** Setoran kas kasir (tabel cash_deposits). */
  deposits?: any[];
  /** Pembayaran bagi hasil / THR yang dicatat owner. */
  settlements?: FinanceSettlement[];
}): JournalLine[] {
  const { txs, mems, exps, books, ref, mode } = opts;
  const keep = (iso: string) => (mode === 'month' ? inMonth(iso, ref) : onOrBefore(iso, ref));
  const rows: JournalLine[] = [];

  books.forEach((book) => {
    const startRef = monthKey(book.booksStart || book.assets[0]?.acquiredAt || '');
    if (startRef) {
      const includeOpening =
        mode === 'month'
          ? startRef.year === ref.year && startRef.month === ref.month
          : startRef.year * 12 + startRef.month <= ref.year * 12 + ref.month;
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
    const voided = isVoidTransaction(t);
    const voidAt = voidDateIso(t);
    // Void tanpa tanggal void: tidak pernah dihitung (sama dengan laporan laba rugi).
    if (voided && !voidAt) return;

    const book = bookByOutlet(books, t.outlet_id);
    if (book && !afterBooksStart(t.created_at, book)) return;

    const all = transactionLines(t);
    // Baris yang terjadi sebelum/saat void saja (koleksi/setor setelah void tidak ada).
    const live = voidAt ? all.filter((r) => new Date(r.date).getTime() <= new Date(voidAt).getTime()) : all;
    live.filter((r) => keep(r.date)).forEach((r) => rows.push(r));
    if (voidAt && keep(voidAt)) {
      // Pembalikan bertanggal voided_at; bulan penjualan tidak diubah.
      pushReversal(rows, live, voidAt, '-void');
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
    // Top up di kasir (tunai) masuk laci dan harus disetor; top up online lewat QRIS Mayar (clearing).
    const online = String(m.order_type || '').toLowerCase() === 'online';
    const asset = online ? BS.CLEARING : BS.UNDEPOSITED;
    const meta = {
      ref: String(m.id || g),
      source: 'membership',
      outletId: m.outlet_id,
      payStatus: online ? ('clearing' as const) : ('undeposited' as const)
    };
    rows.push(
      line(m.created_at, acc(asset.code, asset.label), desc, amt, 0, g, meta)!,
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
    if (isThrSavingCategory(e.category)) {
      // THR crew diakui bertahap (beban, di laba rugi tetap baris Tabungan THR) sebagai utang,
      // dan uangnya dipindah dari laci ke Dana Tabungan THR sampai dibayar saat hari raya.
      rows.push(
        line(e.created_at, akun, desc, amt, 0, g, meta)!,
        line(e.created_at, acc(BS.THR_PAYABLE.code, BS.THR_PAYABLE.label), desc, 0, amt, g, meta)!,
        line(e.created_at, acc(BS.THR_FUND.code, BS.THR_FUND.label), `${desc} · pindah ke tabungan`, amt, 0, `${g}-fund`, meta)!,
        line(e.created_at, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), `${desc} · pindah ke tabungan`, 0, amt, `${g}-fund`, meta)!
      );
      return;
    }
    rows.push(
      line(e.created_at, akun, desc, amt, 0, g, meta)!,
      line(e.created_at, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), desc, 0, amt, g, meta)!
    );
  });

  (opts.deposits || []).forEach((d) => {
    if (!isBalancedCashDeposit(d)) return;
    const date = String(d.paid_at || d.created_at || '');
    if (!date || !keep(date)) return;
    const book = bookByOutlet(books, d.outlet_id);
    if (book && !afterBooksStart(date, book)) return;
    const gross = Number(d.amount_cash) || 0;
    const net = Number(d.net_deposit_amount) || Math.max(0, gross - (Number(d.admin_fee) || 0));
    if (net <= 0) return;
    // Biaya admin sudah tercatat sebagai pengeluaran (keluar dari laci); di sini hanya net-nya.
    const g = `setor-${d.id}`;
    const desc = `Setoran kas kasir${d.deposit_method ? ` (${d.deposit_method})` : ''}`;
    const meta = { ref: String(d.receipt || d.id || g), source: 'cash_deposit', outletId: d.outlet_id, payStatus: 'clearing' as const };
    rows.push(
      line(date, acc(BS.CLEARING.code, BS.CLEARING.label), desc, net, 0, g, meta)!,
      line(date, acc(BS.UNDEPOSITED.code, BS.UNDEPOSITED.label), desc, 0, net, g, meta)!
    );
  });

  (opts.settlements || []).forEach((p) => {
    if (p.voided_at) return;
    const amt = Number(p.amount) || 0;
    if (amt <= 0 || !keep(p.paid_at)) return;
    const liab = p.kind === 'thr' ? BS.THR_PAYABLE : BS.BH;
    const src = SETTLEMENT_SOURCES[p.source] || BS.CASH;
    const g = `bayar-${p.id}`;
    const desc = `${p.kind === 'thr' ? 'Pembayaran THR crew' : 'Pembayaran bagi hasil'}${p.note ? ` · ${p.note}` : ''}`;
    const meta = { ref: g, source: 'settlement', outletId: p.outlet_id, payStatus: 'n/a' as const };
    rows.push(
      line(p.paid_at, acc(liab.code, liab.label), desc, amt, 0, g, meta)!,
      line(p.paid_at, acc(src.code, src.label), desc, 0, amt, g, meta)!
    );
  });

  rows.push(...profitShareLines({ txs, mems, exps, books, ref, mode, rates: opts.rates }));

  return rows
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Bagi hasil pengelolaan terutang, dicatat akhir tiap bulan per outlet:
 * Dr Beban Bagi Hasil / Cr 210010 Bagi Hasil Pengelolaan. Angkanya dihitung
 * dengan mesin Laba Rugi yang sama (buildPnlMonth: transaksi non-void, laba
 * sebelum Tabungan THR, persentase per outlet), jadi neraca = laporan laba rugi.
 * Liabilitas ini menumpuk sampai pembayaran bagi hasil dicatat — tidak hilang
 * saat ganti tahun.
 */
function profitShareLines(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  ref: PnlMonthRef;
  mode: 'month' | 'through';
  rates?: Record<string, number>;
}): JournalLine[] {
  const { books, ref, mode, rates } = opts;
  // Sama dengan laporan laba rugi: void dibalik di bulan void (txRevenueSign).
  const live = opts.txs;
  const idOf = (r: any) => String(r?.outlet_id || '');
  const ids = new Set<string>([
    ...books.map((b) => b.outletId),
    ...live.map(idOf),
    ...opts.mems.map(idOf),
    ...opts.exps.map(idOf)
  ]);
  const out: JournalLine[] = [];
  ids.forEach((id) => {
    const book = bookByOutlet(books, id || null);
    const mine = (r: any) => idOf(r) === id && (!book || afterBooksStart(r.created_at, book));
    const scoped = { txs: live.filter(mine), mems: opts.mems.filter(mine), exps: opts.exps.filter(mine) };
    const dates = [...scoped.txs, ...scoped.mems, ...scoped.exps].map((r) => String(r.created_at || '')).filter(Boolean).sort();
    const start = monthKey(book?.booksStart || dates[0] || '');
    if (!start) return;
    const months = mode === 'month' ? [ref] : eachMonth(start, ref);
    const rate = id ? shareRateOf(rates, id) : PNL_PROFIT_SHARE_RATE;
    months.forEach((m) => {
      if (m.year * 12 + m.month < start.year * 12 + start.month) return;
      const share = buildPnlMonth(
        { ...scoped, depreciation: book ? monthDepreciation(book, m) : 0 },
        m,
        rate
      ).bagiHasil;
      if (share <= 0) return;
      const date = endOfMonthIso(m);
      const g = `bh-${id || 'tanpa-outlet'}-${m.year}-${m.month}`;
      const desc = `Bagi hasil pengelolaan ${m.month + 1}/${m.year} (${Math.round(rate * 100)}% laba bersih)`;
      const meta = { ref: g, source: 'profit_share', outletId: id || null, payStatus: 'n/a' as const };
      out.push(line(date, BH_EXPENSE, desc, share, 0, g, meta)!, line(date, acc(BS.BH.code, BS.BH.label), desc, 0, share, g, meta)!);
    });
  });
  return out;
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
  rates?: Record<string, number>;
  deposits?: any[];
  settlements?: FinanceSettlement[];
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

  return Object.entries(map)
    .map(([name, v]) => ({
      name,
      ...v,
      saldo: isCreditNormal(name) ? v.kredit - v.debit : v.debit - v.kredit
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
  rates?: Record<string, number>;
  deposits?: any[];
  settlements?: FinanceSettlement[];
}): { account: string; opening: number; mutations: LedgerMutation[]; closing: number } {
  const journal = buildJournal({ ...opts, ref: opts.asOf, mode: 'through' })
    .filter((r) => r.akun === opts.account)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Sama dengan ringkasan buku besar (Prive = saldo normal debit).
  const creditNormal = isCreditNormal(opts.account);

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

type Totals = Record<string, { debit: number; kredit: number }>;

const totalsOf = (rows: JournalLine[]): Totals => {
  const map: Totals = {};
  rows.forEach((r) => {
    if (!map[r.akun]) map[r.akun] = { debit: 0, kredit: 0 };
    map[r.akun].debit += r.debit;
    map[r.akun].kredit += r.kredit;
  });
  return map;
};

/** Saldo akun menurut saldo normalnya. */
const balOf = (t: Totals, name: string) => {
  const v = t[name];
  if (!v) return 0;
  return isCreditNormal(name) ? v.kredit - v.debit : v.debit - v.kredit;
};
const bsBal = (t: Totals, a: { code: string; label: string }) => balOf(t, acc(a.code, a.label));

/** Laba (rugi) dari akun laba rugi: pendapatan − beban (termasuk penyusutan & bagi hasil). */
const profitOf = (rows: JournalLine[], exclude?: (name: string) => boolean) =>
  rows.reduce((s, r) => {
    if (isBalanceSheetAccount(r.akun) || exclude?.(r.akun)) return s;
    return s + (r.kredit - r.debit);
  }, 0);

const beforeIso = (iso: string, limit: string) => new Date(iso).getTime() < new Date(limit).getTime();
const yearStartIso = (year: number) => new Date(year, 0, 1, 0, 0, 0).toISOString();
const monthStartIso = (ref: PnlMonthRef) => new Date(ref.year, ref.month, 1, 0, 0, 0).toISOString();

/**
 * Perubahan ekuitas satu bulan, dari jurnal yang sama dengan buku besar & neraca.
 * Laba bulan ini = akun laba rugi bulan itu; bagi hasil dipisah agar terlihat
 * sebelum/sesudah bagi hasil.
 */
export function buildEquity(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  ref: PnlMonthRef;
  rates?: Record<string, number>;
  deposits?: any[];
  settlements?: FinanceSettlement[];
}): EquityStatement {
  const { ref } = opts;
  const through = buildJournal({ ...opts, ref, mode: 'through' });
  const start = monthStartIso(ref);
  const prior = through.filter((r) => beforeIso(r.date, start));
  const period = through.filter((r) => !beforeIso(r.date, start));
  const pt = totalsOf(prior);
  const cap = acc(BS.CAPITAL.code, BS.CAPITAL.label);
  const drw = acc(BS.DRAWING.code, BS.DRAWING.label);
  const gapName = acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label);

  const openingCapital = balOf(pt, cap);
  const priorRetained = profitOf(prior);
  const openingEquity = openingCapital + balOf(pt, gapName) - balOf(pt, drw) + priorRetained;
  // Setoran & saldo awal yang terjadi di bulan ini (termasuk pembukaan bila mulai di bulan ini).
  const periodEquityIn = period.reduce((s, r) => s + (r.akun === cap || r.akun === gapName ? r.kredit - r.debit : 0), 0);
  const drawings = period.reduce((s, r) => s + (r.akun === drw ? r.debit - r.kredit : 0), 0);
  const periodProfitAfterShare = profitOf(period);
  const periodProfit = profitOf(period, (n) => n === BH_EXPENSE);
  return {
    openingCapital,
    priorRetained,
    openingEquity,
    additional: periodEquityIn,
    periodProfit,
    periodProfitAfterShare,
    drawings,
    endingEquity: openingEquity + periodEquityIn + periodProfitAfterShare - drawings
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
  /** Dana Tabungan THR (uang THR yang disisihkan). */
  thrFund: number;
  currentAssets: number;
  faGroups: FaGroupRow[];
  fixedAtCost: number;
  accumDep: number;
  netFixed: number;
  nonCurrent: number;
  totalAssets: number;
  tradePayables: number;
  profitShare: number;
  /** THR crew yang sudah ditabung tetapi belum dibayar. */
  thrPayable: number;
  shortLiab: number;
  longTermPayables: number;
  leasePayables: number;
  longLiab: number;
  totalLiab: number;
  /** Modal disetor kumulatif (awal + tambahan). */
  paidInCapital: number;
  /** Ekuitas per 1 Januari (atau saldo pembukaan bila mulai tahun ini). */
  equityBegin: number;
  /** Laba bersih tahun berjalan setelah penyusutan & bagi hasil. */
  yearProfit: number;
  extraYear: number;
  drawingsYear: number;
  /** Prive kumulatif. */
  drawings: number;
  /** Laba ditahan: laba tahun-tahun sebelumnya. */
  retainedPrior: number;
  /** Laba kumulatif sejak mulai pembukuan (ditahan + tahun berjalan). */
  retained: number;
  openingGap: number;
  totalEquity: number;
  totalPasiva: number;
  assets: { name: string; category: string; cost: number; accum: number; book: number; remainingMonths: number }[];
  completeness: BooksCompleteness;
};

/**
 * Neraca per akhir bulan asOf, disusun dari SALDO BUKU BESAR (jurnal yang
 * sama). Karena setiap jurnal seimbang, aset = liabilitas + ekuitas selalu
 * berlaku, dan tiap angka neraca sama dengan saldo akunnya di buku besar.
 */
export function buildBalanceSheet(opts: {
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  asOf: PnlMonthRef;
  rates?: Record<string, number>;
  deposits?: any[];
  settlements?: FinanceSettlement[];
}): BalanceSheet {
  const { books, asOf } = opts;
  const journal = buildJournal({ ...opts, ref: asOf, mode: 'through' });
  const t = totalsOf(journal);

  const cash = bsBal(t, BS.CASH);
  const undepositedCash = bsBal(t, BS.UNDEPOSITED);
  const receivables = bsBal(t, BS.AR);
  const gatewayClearing = bsBal(t, BS.CLEARING);
  const otherCurrent = bsBal(t, BS.OCA);
  const thrFund = bsBal(t, BS.THR_FUND);
  const currentAssets = cash + undepositedCash + receivables + gatewayClearing + otherCurrent + thrFund;

  // Rincian aset hanya untuk outlet yang saldo awalnya sudah masuk jurnal per asOf.
  const openedBooks = books.filter((b) => {
    const start = monthKey(b.booksStart || b.assets[0]?.acquiredAt || '');
    return Boolean(start) && start!.year * 12 + start!.month <= asOf.year * 12 + asOf.month;
  });
  const assets = openedBooks.flatMap((b) =>
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
  const fixedAtCost = bsBal(t, BS.FA);
  const accumDep = bsBal(t, BS.ACCUM);
  const netFixed = fixedAtCost - accumDep;
  const nonCurrent = netFixed;
  const totalAssets = currentAssets + nonCurrent;

  const tradePayables = bsBal(t, BS.AP);
  const profitShare = bsBal(t, BS.BH);
  const thrPayable = bsBal(t, BS.THR_PAYABLE);
  const longTermPayables = bsBal(t, BS.LT);
  const leasePayables = bsBal(t, BS.LEASE);
  const shortLiab = tradePayables + profitShare + thrPayable;
  const longLiab = longTermPayables + leasePayables;
  const totalLiab = shortLiab + longLiab;

  const cap = acc(BS.CAPITAL.code, BS.CAPITAL.label);
  const drw = acc(BS.DRAWING.code, BS.DRAWING.label);
  const gapName = acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label);
  const paidInCapital = bsBal(t, BS.CAPITAL);
  const drawings = bsBal(t, BS.DRAWING);
  const gap = bsBal(t, BS.OPENING_GAP);

  const ys = yearStartIso(asOf.year);
  const priorRows = journal.filter((r) => beforeIso(r.date, ys));
  const yearRows = journal.filter((r) => !beforeIso(r.date, ys));
  const retainedPrior = profitOf(priorRows);
  const yearProfit = profitOf(yearRows);
  // Saldo pembukaan yang jatuh di tahun ini dihitung sebagai ekuitas awal, bukan setoran tahun ini.
  const openingInYear = yearRows
    .filter((r) => r.source === 'opening' && (r.akun === cap || r.akun === gapName))
    .reduce((s, r) => s + r.kredit - r.debit, 0);
  const pt = totalsOf(priorRows);
  const equityBegin = balOf(pt, cap) + balOf(pt, gapName) - balOf(pt, drw) + retainedPrior + openingInYear;
  const extraYear = yearRows.filter((r) => r.akun === cap && r.source !== 'opening').reduce((s, r) => s + r.kredit - r.debit, 0);
  const drawingsYear = yearRows.filter((r) => r.akun === drw).reduce((s, r) => s + r.debit - r.kredit, 0);
  const totalEquity = paidInCapital + gap - drawings + retainedPrior + yearProfit;
  const totalPasiva = totalLiab + totalEquity;

  const completeness = assessBooksCompleteness(books);
  if (undepositedCash < -0.5) {
    completeness.issues.unshift(
      `Kas tunai belum disetor minus Rp ${Math.round(-undepositedCash).toLocaleString('id-ID')}: ada pengeluaran yang dicatat dari laci ` +
        'padahal dibayar dari rekening/uang pribadi. Catat sumber dananya (prive/setoran modal) agar kas sesuai kenyataan.'
    );
  }

  return {
    cash,
    undepositedCash,
    receivables,
    tradeReceivablesFromSales: receivableRevenueOf(opts.txs, asOf),
    gatewayClearing,
    otherCurrent,
    thrFund,
    currentAssets,
    faGroups,
    fixedAtCost,
    accumDep,
    netFixed,
    nonCurrent,
    totalAssets,
    tradePayables,
    profitShare,
    thrPayable,
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
    drawings,
    retainedPrior,
    retained: retainedPrior + yearProfit,
    openingGap: gap,
    totalEquity,
    totalPasiva,
    assets,
    completeness
  };
}

export { booksOf, financePayKind };
