import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';

export const CASH_DEPOSIT_OPEX = 'Biaya Admin Setoran Cash (OPEX)';

export const cashDepositReceiptOf = (outletId?: string, shiftDate?: string) => {
  const day = String(shiftDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const tail = String(outletId || 'OUT').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'OUT';
  return `SETOR-${day}-${tail}-${Date.now().toString(36).toUpperCase()}`;
};

export const netDepositOf = (physical: number, fee: number) =>
  Math.max(0, Math.round((Number(physical) || 0) - (Number(fee) || 0)));

export const isCashDepositBalanced = (row: any) => {
  const st = String(row?.status || '').toUpperCase();
  const qris = String(row?.status_qris || row?.qr_payment_status || '').toLowerCase();
  return st === 'BALANCED' || qris === 'success' || qris === 'paid';
};

type Db = { from: (table: string) => any };

export async function findCashDeposit(
  db: Db,
  refs: { paymentId?: string; receipt?: string; depositId?: string }
) {
  if (refs.depositId) {
    const { data } = await db.from('cash_deposits').select('*').eq('id', refs.depositId).maybeSingle();
    if (data) return data;
  }
  if (refs.paymentId) {
    const { data } = await db.from('cash_deposits').select('*').eq('mayar_payment_id', refs.paymentId).limit(1);
    if (data?.[0]) return data[0];
  }
  if (refs.receipt) {
    const { data } = await db.from('cash_deposits').select('*').eq('receipt', refs.receipt).order('created_at', { ascending: false }).limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
}

const cashDepositPayloads = (row: {
  outlet_id?: string | null;
  cashier_id?: string | null;
  kasir_id?: string | null;
  amount_cash: number;
  admin_fee: number;
  net_deposit_amount: number;
  deposit_method?: string;
  mayar_payment_id?: string | null;
  mayar_invoice_url?: string | null;
  qris_image_url?: string | null;
  receipt?: string;
  shift_date?: string;
  proof_url?: string;
}) => {
  const full = {
    outlet_id: row.outlet_id || null,
    cashier_id: row.cashier_id || row.kasir_id || null,
    kasir_id: row.kasir_id || row.cashier_id || null,
    amount_cash: row.amount_cash,
    admin_fee: row.admin_fee,
    net_deposit_amount: row.net_deposit_amount,
    deposit_method: row.deposit_method || 'MAYAR_QRIS',
    qr_payment_status: 'pending',
    status: 'PENDING',
    status_qris: 'pending',
    mayar_payment_id: row.mayar_payment_id || null,
    mayar_invoice_url: row.mayar_invoice_url || null,
    qris_image_url: row.qris_image_url || null,
    receipt: row.receipt || null,
    shift_date: row.shift_date || null,
    proof_url: row.proof_url || 'Setor via QRIS Mayar'
  };
  return [
    full,
    {
      outlet_id: full.outlet_id,
      cashier_id: full.cashier_id,
      amount_cash: full.amount_cash,
      admin_fee: full.admin_fee,
      deposit_method: full.deposit_method,
      qr_payment_status: 'pending',
      mayar_payment_id: full.mayar_payment_id,
      proof_url: full.proof_url,
      receipt: full.receipt
    },
    {
      outlet_id: full.outlet_id,
      amount_cash: full.amount_cash,
      admin_fee: full.admin_fee,
      qr_payment_status: 'pending'
    }
  ];
};

export async function insertPendingCashDepositDb(db: Db, row: Parameters<typeof cashDepositPayloads>[0]) {
  let lastErr: { message: string } | null = null;
  for (const attempt of cashDepositPayloads(row)) {
    const clean = Object.fromEntries(Object.entries(attempt).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const { data, error } = await db.from('cash_deposits').insert([clean]).select('*');
    if (!error) return { data, error: null };
    lastErr = { message: error.message };
  }
  return { data: null, error: lastErr || { message: 'Gagal menyimpan setoran' } };
}

export async function insertPendingCashDeposit(row: Parameters<typeof cashDepositPayloads>[0]) {
  return insertWithFallback('cash_deposits', cashDepositPayloads(row));
}

const ensureAdminFeeExpense = async (db: Db, deposit: any) => {
  const fee = Number(deposit.admin_fee) || 0;
  if (fee <= 0) return { expenseId: deposit.expense_id || null, created: false };
  if (deposit.expense_id) return { expenseId: deposit.expense_id, created: false };

  const tag = deposit.receipt || deposit.id;
  const { data: existing } = await db
    .from('expenses')
    .select('id')
    .eq('outlet_id', deposit.outlet_id)
    .ilike('notes', `%${tag}%`)
    .limit(1);
  if (existing?.[0]?.id) return { expenseId: existing[0].id, created: false };

  const payload = {
    outlet_id: deposit.outlet_id || null,
    amount: fee,
    category: 'Biaya Admin',
    notes: `${CASH_DEPOSIT_OPEX} · ${tag}`
  };
  const { data, error } = await db.from('expenses').insert([payload]).select('id');
  if (error) {
    const retry = await db.from('expenses').insert([{ outlet_id: payload.outlet_id, amount: fee, notes: payload.notes }]).select('id');
    return { expenseId: retry.data?.[0]?.id || null, created: !retry.error };
  }
  return { expenseId: data?.[0]?.id || null, created: true };
};

export async function settleCashDeposit(db: Db, deposit: any) {
  if (!deposit?.id) return { already: false, error: { message: 'Setoran kosong' } };
  if (isCashDepositBalanced(deposit) && deposit.expense_id) {
    return { already: true, error: null, deposit };
  }

  const { expenseId } = await ensureAdminFeeExpense(db, deposit);
  const paidAt = new Date().toISOString();
  const attempts = [
    {
      status: 'BALANCED',
      status_qris: 'SUCCESS',
      qr_payment_status: 'SUCCESS',
      paid_at: paidAt,
      expense_id: expenseId || null
    },
    { status: 'BALANCED', status_qris: 'SUCCESS', qr_payment_status: 'SUCCESS' },
    { qr_payment_status: 'SUCCESS', status: 'BALANCED' },
    { qr_payment_status: 'SUCCESS' }
  ];

  let lastErr: { message: string } | null = null;
  for (const row of attempts) {
    const { error } = await db.from('cash_deposits').update(row).eq('id', deposit.id);
    if (!error) {
      return { already: isCashDepositBalanced(deposit), error: null, deposit: { ...deposit, ...row } };
    }
    lastErr = { message: error.message };
  }
  return { already: false, error: lastErr || { message: 'Gagal menandai setoran BALANCED' }, deposit };
}

export async function markCashDepositBalancedClient(depositId: string, actorId?: string) {
  const attempts: Record<string, unknown>[] = [
    { status: 'BALANCED', status_qris: 'SUCCESS', qr_payment_status: 'SUCCESS', paid_at: new Date().toISOString() },
    { status: 'BALANCED', qr_payment_status: 'SUCCESS' },
    { qr_payment_status: 'SUCCESS' }
  ];
  void actorId;
  return updateWithFallback('cash_deposits', attempts, { column: 'id', value: depositId });
}
