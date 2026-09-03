import { insertWithFallback } from '@/lib/safeWrite';

export type PayBucket = 'cash' | 'qris' | 'deposit';

export function payBucket(method: unknown): PayBucket {
  const s = String(method || '').toLowerCase();
  if (s.includes('deposit')) return 'deposit';
  if (
    s.includes('qris') ||
    s.includes('transfer') ||
    s.includes('va') ||
    s.includes('ewallet') ||
    s.includes('e-wallet') ||
    s.includes('mayar')
  ) {
    return 'qris';
  }
  return 'cash';
}

export function isOnlineOrderType(orderType: unknown) {
  const s = String(orderType || '').toLowerCase();
  return s.includes('online') || s.includes('app') || s.includes('wa') || s.includes('whatsapp');
}

/** Jurnal kas Owner — dipanggil setelah transaksi POS / top-up member sukses. */
export async function logCashflow(row: {
  outlet_id?: string | null;
  type?: 'income' | 'expense';
  source?: string;
  amount: number;
  payment_method?: string;
  reference_id?: string | null;
  note?: string;
  actor_name?: string;
}) {
  const amount = Number(row.amount) || 0;
  if (amount <= 0) return { error: null };
  const type = row.type || 'income';
  const note = row.note || (type === 'income' ? 'Omset POS' : 'Pengeluaran POS');
  return insertWithFallback('cashflow_logs', [
    {
      outlet_id: row.outlet_id || null,
      type,
      source: row.source || 'pos',
      amount,
      payment_method: row.payment_method || null,
      reference_id: row.reference_id || null,
      note,
      actor_name: row.actor_name || null
    },
    {
      outlet_id: row.outlet_id || null,
      type,
      amount,
      payment_method: row.payment_method || null,
      note
    },
    {
      outlet_id: row.outlet_id || null,
      amount,
      description: note
    }
  ]);
}

/** Antrian Persetujuan Owner — dual-write dari pengajuan kasir. */
export async function writeSubmission(row: {
  type: string;
  outlet_id?: string | null;
  requested_by?: string;
  title: string;
  amount?: number;
  description?: string;
  source_table?: string;
  source_id?: string | null;
  status?: string;
}) {
  const status = row.status || 'pending';
  return insertWithFallback('submissions', [
    {
      type: row.type,
      status,
      outlet_id: row.outlet_id || null,
      requested_by: row.requested_by || null,
      title: row.title,
      amount: Number(row.amount) || 0,
      description: row.description || null,
      source_table: row.source_table || null,
      source_id: row.source_id || null
    },
    {
      type: row.type,
      status,
      outlet_id: row.outlet_id || null,
      title: row.title,
      amount: Number(row.amount) || 0,
      description: row.description || null
    },
    {
      outlet_id: row.outlet_id || null,
      title: row.title,
      description: row.description || row.title
    }
  ]);
}

export async function logInventoryChange(row: {
  outlet_id?: string | null;
  item_name: string;
  qty: number;
  unit?: string;
  note?: string;
  actor_name?: string;
}) {
  const qty = Number(row.qty) || 0;
  if (!row.item_name) return { error: null };
  return insertWithFallback('inventory_logs', [
    {
      outlet_id: row.outlet_id || null,
      item_name: row.item_name,
      qty,
      unit: row.unit || 'kg',
      note: row.note || null,
      actor_name: row.actor_name || null
    },
    {
      outlet_id: row.outlet_id || null,
      item_name: row.item_name,
      qty,
      note: row.note || null
    },
    {
      outlet_id: row.outlet_id || null,
      item_name: row.item_name,
      qty
    }
  ]);
}
