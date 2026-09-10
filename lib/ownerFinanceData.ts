import { supabase } from '@/lib/supabaseClient';
import { isVoidTransaction } from '@/lib/voidTx';

export type FinanceBundle = {
  txs: any[];
  mems: any[];
  exps: any[];
  outlets: { id: string; name: string }[];
};

export async function loadOwnerFinanceBundle(): Promise<FinanceBundle> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const sinceIso = since.toISOString();

  const [{ data: outlets }, { data: txs }, { data: mems }, { data: exps }] = await Promise.all([
    supabase.from('outlets').select('id, name').order('name'),
    supabase
      .from('transactions')
      .select(
        'id, outlet_id, amount, delivery_fee, order_type, service_type, customer_name, receipt_number, created_at, status, is_void, delete_requested'
      )
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(3000),
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
  return {
    outlets: outlets || [],
    txs: (txs || []).filter((t) => !isVoidTransaction(t)),
    mems: mems || [],
    exps: exps || []
  };
}

export const filterByOutlet = (rows: any[], outletId: string) =>
  outletId === 'ALL' ? rows : rows.filter((r) => r.outlet_id === outletId);

export const inCalendarMonth = (iso: string, year: number, month: number) => {
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
};
