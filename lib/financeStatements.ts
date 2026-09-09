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

export const BS = {
  CASH: { code: '110001', label: 'Rekening Bank Outlet / Omset' },
  AR: { code: '110002', label: 'Piutang Usaha' },
  OCA: { code: '110003', label: 'Aset Lancar Lainnya' },
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

export type JournalLine = {
  date: string;
  akun: string;
  desc: string;
  debit: number;
  kredit: number;
  group: string;
};

export type LedgerRow = {
  name: string;
  debit: number;
  kredit: number;
  saldo: number;
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

export function cashRevenueOf(txs: any[], mems: any[], through?: PnlMonthRef) {
  const ok = (iso: string) => (through ? onOrBefore(iso, through) : true);
  const tx = txs.filter((t) => ok(t.created_at)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const mem = mems.filter((m) => ok(m.created_at)).reduce((s, m) => s + (Number(m.price) || 0), 0);
  return tx + mem;
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

function line(date: string, akun: string, desc: string, debit: number, kredit: number, group: string): JournalLine | null {
  if (!(debit > 0 || kredit > 0)) return null;
  return { date, akun, desc, debit, kredit, group };
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
  return [
    line(date, acc(BS.CASH.code, BS.CASH.label), desc, cash, 0, g),
    line(date, acc(BS.AR.code, BS.AR.label), desc, ar, 0, g),
    line(date, acc(BS.OCA.code, BS.OCA.label), desc, oca, 0, g),
    line(date, acc(BS.FA.code, BS.FA.label), desc, fa, 0, g),
    line(date, acc(BS.CAPITAL.code, BS.CAPITAL.label), desc, 0, capital, g),
    line(date, acc(BS.AP.code, BS.AP.label), desc, 0, ap, g),
    line(date, acc(BS.LT.code, BS.LT.label), desc, 0, lt, g),
    line(date, acc(BS.LEASE.code, BS.LEASE.label), desc, 0, lease, g),
    gap > 0.5
      ? line(date, acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label), 'Selisih pembukaan', 0, gap, g)
      : gap < -0.5
        ? line(date, acc(BS.OPENING_GAP.code, BS.OPENING_GAP.label), 'Selisih pembukaan', Math.abs(gap), 0, g)
        : null
  ].filter((r): r is JournalLine => Boolean(r));
}

function depLine(book: OutletBook, ref: PnlMonthRef): JournalLine[] {
  const dep = monthDepreciation(book, ref);
  if (dep <= 0) return [];
  const date = endOfMonthIso(ref);
  const desc = 'Penyusutan aset tetap (garis lurus)';
  const g = `dep-${book.outletId}-${ref.year}-${ref.month}`;
  return [
    line(date, acc(BS.DEP.code, BS.DEP.label), desc, dep, 0, g),
    line(date, acc(BS.ACCUM.code, BS.ACCUM.label), desc, 0, dep, g)
  ].filter((r): r is JournalLine => Boolean(r));
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
      const includeOpening = mode === 'month' ? startRef.year === ref.year && startRef.month === ref.month : onOrBefore(book.booksStart || '', ref);
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
        rows.push(
          line(mv.date, acc(BS.CASH.code, BS.CASH.label), desc, mv.amount, 0, g)!,
          line(mv.date, acc(BS.CAPITAL.code, BS.CAPITAL.label), desc, 0, mv.amount, g)!
        );
      }
    });
    book.drawings.forEach((mv) => {
      if (keep(mv.date) && mv.amount > 0) {
        const g = `prv-${mv.id}`;
        const desc = mv.note || 'Prive';
        rows.push(
          line(mv.date, acc(BS.DRAWING.code, BS.DRAWING.label), desc, mv.amount, 0, g)!,
          line(mv.date, acc(BS.CASH.code, BS.CASH.label), desc, 0, mv.amount, g)!
        );
      }
    });
  });

  txs.forEach((t) => {
    if (!keep(t.created_at)) return;
    const amt = Number(t.amount) || 0;
    const fee = Number(t.delivery_fee) || 0;
    const laundry = Math.max(0, amt - fee);
    const rev = String(t.order_type || '').toLowerCase() === 'online' ? PNL_REVENUE[1] : PNL_REVENUE[0];
    const desc = `${t.receipt_number || 'TRX'} · ${t.customer_name || '-'}`;
    const g = `tx-${t.id}`;
    if (laundry > 0) {
      rows.push(
        line(t.created_at, acc(BS.CASH.code, BS.CASH.label), desc, laundry, 0, `${g}-l`)!,
        line(t.created_at, acc(rev.code, rev.label), desc, 0, laundry, `${g}-l`)!
      );
    }
    if (fee > 0) {
      rows.push(
        line(t.created_at, acc(BS.CASH.code, BS.CASH.label), desc, fee, 0, `${g}-f`)!,
        line(t.created_at, acc(PNL_REVENUE[2].code, PNL_REVENUE[2].label), desc, 0, fee, `${g}-f`)!
      );
    }
    if (!laundry && !fee && amt > 0) {
      rows.push(
        line(t.created_at, acc(BS.CASH.code, BS.CASH.label), desc, amt, 0, g)!,
        line(t.created_at, acc(rev.code, rev.label), desc, 0, amt, g)!
      );
    }
  });

  mems.forEach((m) => {
    if (!keep(m.created_at)) return;
    const amt = Number(m.price) || 0;
    if (amt <= 0) return;
    const desc = m.package_name || 'Member';
    const g = `mem-${m.id}`;
    rows.push(
      line(m.created_at, acc(BS.CASH.code, BS.CASH.label), desc, amt, 0, g)!,
      line(m.created_at, acc(PNL_REVENUE[3].code, PNL_REVENUE[3].label), desc, 0, amt, g)!
    );
  });

  exps.forEach((e) => {
    if (!keep(e.created_at)) return;
    const amt = Number(e.amount) || 0;
    if (amt <= 0) return;
    const akun = String(e.category || 'Beban');
    const desc = e.description || '-';
    const g = `exp-${e.id}`;
    rows.push(
      line(e.created_at, akun, desc, amt, 0, g)!,
      line(e.created_at, acc(BS.CASH.code, BS.CASH.label), desc, 0, amt, g)!
    );
  });

  return rows
    .filter(Boolean)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
  [BS.CASH, BS.AR, BS.OCA, BS.FA, BS.ACCUM, BS.AP, BS.BH, BS.LT, BS.LEASE, BS.CAPITAL, BS.DRAWING, BS.DEP].forEach((a) => add(acc(a.code, a.label), 0, 0));
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

export type EquityStatement = {
  openingCapital: number;
  priorRetained: number;
  openingEquity: number;
  additional: number;
  periodProfit: number;
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
}): EquityStatement {
  const { txs, mems, exps, books, ref } = opts;
  const prior = prevMonth(ref);
  const openingCapital = books.reduce((s, b) => s + (Number(b.openingCapital) || 0), 0);
  const extraThrough = (through: PnlMonthRef) =>
    books.reduce((s, b) => s + b.extraCapital.filter((m) => onOrBefore(m.date, through)).reduce((n, m) => n + (Number(m.amount) || 0), 0), 0);
  const drawThrough = (through: PnlMonthRef) =>
    books.reduce((s, b) => s + b.drawings.filter((m) => onOrBefore(m.date, through)).reduce((n, m) => n + (Number(m.amount) || 0), 0), 0);

  const extraPrior = extraThrough(prior);
  const drawPrior = drawThrough(prior);
  const extraPeriod = extraThrough(ref) - extraPrior;
  const drawPeriod = drawThrough(ref) - drawPrior;

  const priorRetained =
    cashRevenueOf(txs, mems, prior) - cashExpenseOf(exps, prior) - depThrough(books, prior);
  const periodProfit =
    periodRevenue(txs, mems, ref) -
    periodExpense(exps, ref) -
    books.reduce((s, b) => s + monthDepreciation(b, ref), 0);

  const openingEquity = openingCapital + extraPrior - drawPrior + priorRetained;
  return {
    openingCapital,
    priorRetained,
    openingEquity,
    additional: extraPeriod,
    periodProfit,
    drawings: drawPeriod,
    endingEquity: openingEquity + extraPeriod + periodProfit - drawPeriod
  };
}

export type FaGroupRow = { key: string; label: string; short: string; cost: number; accum: number };

export type BalanceSheet = {
  cash: number;
  receivables: number;
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
    const laba = cashRevenueOf(txs.filter((t) => inYearThrough(t.created_at, asOf)), mems.filter((m) => inYearThrough(m.created_at, asOf)))
      - cashExpenseOf(exps.filter((e) => inYearThrough(e.created_at, asOf)))
      - ytdDep([], asOf);
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
  const extraAll = books.reduce((s, b) => s + b.extraCapital.filter((m) => onOrBefore(m.date, asOf)).reduce((n, m) => n + (Number(m.amount) || 0), 0), 0);
  const extraPrior = books.reduce((s, b) => s + b.extraCapital.filter((m) => onOrBefore(m.date, prior)).reduce((n, m) => n + (Number(m.amount) || 0), 0), 0);
  const extraYear = extraAll - extraPrior;
  const drawAll = books.reduce((s, b) => s + b.drawings.filter((m) => onOrBefore(m.date, asOf)).reduce((n, m) => n + (Number(m.amount) || 0), 0), 0);
  const drawPrior = books.reduce((s, b) => s + b.drawings.filter((m) => onOrBefore(m.date, prior)).reduce((n, m) => n + (Number(m.amount) || 0), 0), 0);
  const drawingsYear = drawAll - drawPrior;
  const revenue = cashRevenueOf(txs, mems, asOf);
  const expense = cashExpenseOf(exps, asOf);
  const revPrior = cashRevenueOf(txs, mems, prior);
  const expPrior = cashExpenseOf(exps, prior);
  const depAll = books.reduce((s, b) => s + accumDepreciation(b, asOf), 0);
  const depPrior = depThrough(books, prior);
  const cash = cashOpen + extraAll + revenue - expense - drawAll;
  const receivables = books.reduce((s, b) => s + (Number(b.receivables) || 0), 0);
  const otherCurrent = books.reduce((s, b) => s + (Number(b.otherCurrentAssets) || 0), 0);
  const currentAssets = cash + receivables + otherCurrent;

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
  const ytdRev = cashRevenueOf(txs.filter((t) => inYearThrough(t.created_at, asOf)), mems.filter((m) => inYearThrough(m.created_at, asOf)));
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
    receivables,
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
    assets
  };
}

export { booksOf };
