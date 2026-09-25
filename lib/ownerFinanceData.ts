import { supabase } from '@/lib/supabaseClient';
import { isVoidTransaction } from '@/lib/voidTx';

export type FinanceBundle = {
  /** Non-void — untuk PnL / omset. */
  txs: any[];
  /** Void bertanggal — digabung ke jurnal/ledger agar pembalikan tidak menghapus jejak bulan jual. */
  voidedTxs: any[];
  mems: any[];
  exps: any[];
  outlets: { id: string; name: string }[];
  /** Data dimuat sejak tanggal ini. */
  since: string;
  /** Lebih dari batas pengaman baris — angka neraca bisa kurang lengkap. */
  truncated: boolean;
};

const TX_FULL =
  'id, outlet_id, amount, delivery_fee, order_type, service_type, customer_name, receipt_number, created_at, status, is_void, delete_requested, is_paid, payment_status, payment_method, paid_via, mayar_payment_id, paid_at, voided_at, settled_at, deposited_at';
const TX_BASIC =
  'id, outlet_id, amount, delivery_fee, order_type, service_type, customer_name, receipt_number, created_at, status, is_void, delete_requested, is_paid, payment_status, payment_method, paid_via, mayar_payment_id, paid_at, voided_at';
const PAGE = 1000;
/** Batas pengaman per tabel (≈ 50 halaman); di atas ini laporan memberi peringatan, bukan diam-diam terpotong. */
const MAX_ROWS = 50_000;

/** Semua baris sejak `since`, halaman per halaman (PostgREST membatasi per request). */
async function fetchAll(table: string, columns: string, sinceIso: string) {
  const rows: any[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows, error, truncated: false };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

/**
 * Data laporan keuangan owner. Neraca & buku besar bersifat kumulatif sejak
 * tanggal mulai pembukuan, jadi `since` harus mencakup tanggal itu (bukan
 * hanya 12 bulan terakhir) dan tidak boleh terpotong diam-diam.
 */
export async function loadOwnerFinanceBundle(opts: { since?: string } = {}): Promise<FinanceBundle> {
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const wanted = opts.since ? new Date(opts.since) : yearAgo;
  const sinceIso = (Number.isNaN(wanted.getTime()) || wanted > yearAgo ? yearAgo : wanted).toISOString();

  let tx = await fetchAll('transactions', TX_FULL, sinceIso);
  if (tx.error) tx = await fetchAll('transactions', TX_BASIC, sinceIso);

  const [{ data: outlets }, mems, exps] = await Promise.all([
    supabase.from('outlets').select('id, name').order('name'),
    fetchAll('membership_logs', 'id, outlet_id, price, package_name, customer_phone, order_type, created_at', sinceIso),
    fetchAll('expenses', 'id, outlet_id, amount, category, description, created_at', sinceIso)
  ]);

  const all = tx.rows.filter((t) => !t.delete_requested);
  return {
    outlets: outlets || [],
    txs: all.filter((t) => !isVoidTransaction(t)),
    voidedTxs: all.filter((t) => isVoidTransaction(t)),
    mems: mems.rows,
    exps: exps.rows,
    since: sinceIso,
    truncated: tx.truncated || mems.truncated || exps.truncated
  };
}

/** Tanggal mulai pembukuan paling awal (untuk memuat data neraca secukupnya). */
export const earliestBooksStart = (books: { booksStart?: string }[]) =>
  books
    .map((b) => String(b.booksStart || ''))
    .filter((d) => d && !Number.isNaN(new Date(d).getTime()))
    .sort()[0] || '';

/** Transaksi untuk jurnal/buku besar/neraca aset (termasuk void agar bisa dibalik). */
export const ledgerTxsOf = (bundle: Pick<FinanceBundle, 'txs' | 'voidedTxs'>) => [
  ...bundle.txs,
  ...bundle.voidedTxs
];

export const filterByOutlet = (rows: any[], outletId: string) =>
  outletId === 'ALL' ? rows : rows.filter((r) => r.outlet_id === outletId);

export const inCalendarMonth = (iso: string, year: number, month: number) => {
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
};
