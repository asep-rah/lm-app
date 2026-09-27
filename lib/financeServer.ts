/**
 * Data keuangan satu outlet untuk server (service role) — dipakai closing shift
 * (/api/staff/cash-closing) agar "kas sistem" = saldo Kas Tunai Belum Disetor di
 * buku besar, persis sama dengan neraca. Import HANYA dari API routes.
 */
import { buildBalanceSheet } from '@/lib/financeStatements';
import { settlementForJournal } from '@/lib/financeSettlement';
import { booksFromSettings } from '@/lib/outletBooks';

import type { paymentServiceDb } from '@/lib/paymentSecurity';

type Db = ReturnType<typeof paymentServiceDb>;
type Row = Record<string, unknown>;

const PAGE = 1000;
const MAX_ROWS = 50_000;
const TX_FULL =
  'id, outlet_id, amount, delivery_fee, order_type, customer_name, receipt_number, created_at, status, is_void, delete_requested, is_paid, payment_status, payment_method, paid_via, paid_at, voided_at, settled_at, deposited_at';
const TX_BASIC =
  'id, outlet_id, amount, delivery_fee, order_type, customer_name, receipt_number, created_at, status, is_void, delete_requested, is_paid, payment_status, payment_method, paid_via, paid_at, voided_at';

async function fetchOutletRows(db: Db, table: string, columns: string, outletId: string, dateCol = 'created_at') {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq('outlet_id', outletId)
      .order(dateCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...((data || []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

/** Semua data keuangan satu outlet (transaksi termasuk void agar pembaliknya ikut). */
export async function loadOutletFinance(db: Db, outletId: string) {
  let tx = await fetchOutletRows(db, 'transactions', TX_FULL, outletId);
  if (tx.error) tx = await fetchOutletRows(db, 'transactions', TX_BASIC, outletId);
  if (tx.error) throw new Error(`transactions: ${tx.error.message}`);
  const [mems, exps, deposits, closings, settlements, settings] = await Promise.all([
    fetchOutletRows(db, 'membership_logs', '*', outletId),
    fetchOutletRows(db, 'expenses', '*', outletId),
    fetchOutletRows(db, 'cash_deposits', '*', outletId),
    fetchOutletRows(db, 'cash_closings', '*', outletId),
    fetchOutletRows(db, 'finance_settlements', '*', outletId, 'paid_at'),
    db.from('app_settings').select('outlet_books, outlet_overrides').eq('id', 1).maybeSingle()
  ]);
  if (mems.error) throw new Error(`membership_logs: ${mems.error.message}`);
  if (exps.error) throw new Error(`expenses: ${exps.error.message}`);
  const store = booksFromSettings(settings?.data);
  return {
    txs: tx.rows.filter((t) => !t.delete_requested),
    mems: mems.rows,
    exps: exps.rows,
    deposits: deposits.error ? [] : deposits.rows,
    closings: closings.error ? [] : closings.rows,
    settlements: settlements.error ? [] : settlements.rows.map(settlementForJournal),
    books: store[outletId] ? [store[outletId]] : []
  };
}

/** Bulan kalender Asia/Jakarta sekarang. */
export const jakartaMonth = (now = new Date()) => {
  const d = new Date(now.getTime() + 7 * 3600_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
};

/** Saldo Kas Tunai Belum Disetor (laci) outlet saat ini, sama dengan neraca. */
export async function drawerBalanceNow(db: Db, outletId: string) {
  const data = await loadOutletFinance(db, outletId);
  return buildBalanceSheet({ ...data, asOf: jakartaMonth() }).undepositedCash;
}

/** Tanggal Asia/Jakarta (YYYY-MM-DD) dari ISO timestamp. */
export const jakartaDay = (iso: string | number | Date = new Date()) =>
  new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * Tutup buku untuk penulisan dari server. Trigger guard_finance_period hanya
 * mengunci browser (anon/authenticated), jadi route server wajib memeriksa
 * sendiri. Mengembalikan tanggal kunci bila `iso` jatuh di periode terkunci.
 */
export async function lockedPeriodFor(db: Db, outletId: string | null | undefined, iso: string | number | Date = new Date()) {
  if (!outletId) return null;
  const { data, error } = await db.from('finance_period_locks').select('locked_through').eq('outlet_id', outletId).maybeSingle();
  if (error || !data?.locked_through) return null;
  const lock = String(data.locked_through).slice(0, 10);
  return jakartaDay(iso) <= lock ? lock : null;
}
