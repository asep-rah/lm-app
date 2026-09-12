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
};

export async function loadOwnerFinanceBundle(): Promise<FinanceBundle> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const sinceIso = since.toISOString();

  let txRows: any[] | null = null;
  {
    const full = await supabase
      .from('transactions')
      .select(
        'id, outlet_id, amount, delivery_fee, order_type, service_type, customer_name, receipt_number, created_at, status, is_void, delete_requested, is_paid, payment_status, payment_method, paid_via, mayar_payment_id, paid_at, voided_at, settled_at, deposited_at'
      )
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(3000);
    if (full.error) {
      const basic = await supabase
        .from('transactions')
        .select(
          'id, outlet_id, amount, delivery_fee, order_type, service_type, customer_name, receipt_number, created_at, status, is_void, delete_requested, is_paid, payment_status, payment_method, paid_via, mayar_payment_id, paid_at, voided_at'
        )
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(3000);
      txRows = basic.data;
    } else {
      txRows = full.data;
    }
  }

  const [{ data: outlets }, { data: mems }, { data: exps }] = await Promise.all([
    supabase.from('outlets').select('id, name').order('name'),
    supabase
      .from('membership_logs')
      .select('id, outlet_id, price, package_name, customer_phone, order_type, created_at')
      .gte('created_at', sinceIso)
      .limit(2000),
    supabase
      .from('expenses')
      .select('id, outlet_id, amount, category, description, created_at')
      .gte('created_at', sinceIso)
      .limit(2000)
  ]);

  const all = (txRows || []).filter((t) => !t.delete_requested);
  return {
    outlets: outlets || [],
    txs: all.filter((t) => !isVoidTransaction(t)),
    voidedTxs: all.filter((t) => isVoidTransaction(t)),
    mems: mems || [],
    exps: exps || []
  };
}

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
