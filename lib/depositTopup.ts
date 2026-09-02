/** Paket top-up deposit pelanggan + label income Finance/POS. */

export type DepositPackageKey = 'Silver' | 'Gold' | 'Platinum';

export const DEPOSIT_PACKAGES: {
  key: DepositPackageKey;
  label: string;
  pay: number;
  credit: number;
  bonus: number;
}[] = [
  { key: 'Silver', label: 'Paket Silver', pay: 300_000, credit: 320_000, bonus: 20_000 },
  { key: 'Gold', label: 'Paket Gold', pay: 500_000, credit: 550_000, bonus: 50_000 },
  { key: 'Platinum', label: 'Paket Platinum', pay: 900_000, credit: 1_000_000, bonus: 100_000 }
];

export const depositBonusOf = (pkg: { pay?: number; credit?: number; bonus?: number } | null | undefined) => {
  const explicit = Number(pkg?.bonus);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Math.max(0, Number(pkg?.credit || 0) - Number(pkg?.pay || 0));
};

export const depositPackageOf = (name: any) => {
  const raw = String(name || '').toLowerCase();
  return DEPOSIT_PACKAGES.find((p) => raw.includes(p.key.toLowerCase())) || null;
};

export const depositPackageShort = (name: any) => {
  const found = depositPackageOf(name);
  if (found) return found.key;
  const stripped = String(name || 'Deposit').replace(/^Top Up Deposit\s*[-–]\s*/i, '').trim();
  return stripped || 'Deposit';
};

export const depositIncomeTitle = (row: any) => `Top Up Deposit - ${depositPackageShort(row?.package_name || row?.packageName)}`;

export const isMayarDepositIncome = (row: any) => {
  const pkg = String(row?.package_name || '').toLowerCase();
  const by = String(row?.processed_by || '').toLowerCase();
  return pkg.includes('top up deposit') || by.includes('mayar');
};

export const depositReceiptOf = (pkg: string) =>
  `DEP-${depositPackageShort(pkg).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

export const normalizeCustomerPhone = (raw: string) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('62')) d = '0' + d.slice(2);
  else if (d.startsWith('8') && d.length >= 9 && d.length <= 13) d = '0' + d;
  return d;
};

type Db = {
  from: (table: string) => any;
  rpc?: (fn: string, args: Record<string, unknown>) => any;
};

const rpcMissing = (err: any) => {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('could not find') || msg.includes('schema cache') || msg.includes('does not exist');
};

export async function decrementCustomerDeposit(db: any, phone: string, amount: number) {
  const pay = Number(amount) || 0;
  if (pay <= 0) return { balance: null as number | null, error: { message: 'Nominal potong deposit tidak valid' } };
  if (db.rpc) {
    const { data, error } = await db.rpc('decrement_customer_deposit', { p_phone: phone, p_amount: pay });
    if (!error) return { balance: Number(data), error: null };
    if (!rpcMissing(error)) return { balance: null, error: { message: error.message } };
  }
  const variants = phonesOf(phone);
  const { data: existing } = await db.from('customers').select('phone, deposit_balance').in('phone', variants).limit(1);
  const row = existing?.[0];
  if (!row) return { balance: null, error: { message: 'Pelanggan tidak ditemukan' } };
  const current = Number(row.deposit_balance || 0);
  if (current < pay) return { balance: null, error: { message: 'Saldo deposit tidak cukup' } };
  const next = current - pay;
  const { error } = await db.from('customers').update({ deposit_balance: next }).eq('phone', row.phone);
  if (error) return { balance: null, error: { message: error.message } };
  return { balance: next, error: null };
}

export async function creditCustomerDeposit(db: any, phone: string, amount: number, paymentId: string) {
  const pay = Number(amount) || 0;
  if (pay <= 0) return { balance: null as number | null, error: { message: 'Nominal kredit deposit tidak valid' }, already: false };
  if (db.rpc) {
    const { data, error } = await db.rpc('credit_customer_deposit', {
      p_phone: phone,
      p_amount: pay,
      p_payment_id: paymentId || ''
    });
    if (!error) return { balance: Number(data), error: null, already: false };
    if (!rpcMissing(error)) return { balance: null, error: { message: error.message }, already: false };
  }
  const variants = phonesOf(phone);
  const pid = String(paymentId || '').trim();
  if (pid) {
    const seen = await db.from('deposit_payment_credits').select('payment_id').eq('payment_id', pid).maybeSingle();
    if (!seen.error && seen.data) {
      const { data: existing } = await db.from('customers').select('deposit_balance').in('phone', variants.length ? variants : [phone]).limit(1);
      return { balance: Number(existing?.[0]?.deposit_balance || 0), error: null, already: true };
    }
  }
  const { data: existing } = await db.from('customers').select('phone, deposit_balance').in('phone', variants.length ? variants : [phone]).limit(1);
  const row = existing?.[0];
  const nextBal = Number(row?.deposit_balance || 0) + pay;
  const targetPhone = row?.phone || phone;
  if (row) {
    const { error } = await db.from('customers').update({ deposit_balance: nextBal }).eq('phone', targetPhone);
    if (error) return { balance: null, error: { message: error.message }, already: false };
  } else if (phone) {
    const ins = await insertAttempts(db, 'customers', [
      { phone, name: 'Pelanggan', deposit_balance: nextBal },
      { phone, deposit_balance: nextBal }
    ]);
    if (ins.error) return { balance: null, error: ins.error, already: false };
  }
  if (pid) {
    await db.from('deposit_payment_credits').insert([{ payment_id: pid, customer_phone: targetPhone, amount: pay }]);
  }
  return { balance: nextBal, error: null, already: false };
}

const phonesOf = (raw: string) => {
  const d = String(raw || '').replace(/\D/g, '');
  const out = new Set<string>();
  if (raw) out.add(String(raw).trim());
  if (d) out.add(d);
  if (d.startsWith('0') && d.length > 4) {
    out.add('62' + d.slice(1));
    out.add('+62' + d.slice(1));
  }
  if (d.startsWith('62') && d.length > 4) out.add('0' + d.slice(2));
  const local = normalizeCustomerPhone(raw);
  if (local) out.add(local);
  return [...out].filter(Boolean);
};

const insertAttempts = async (db: Db, table: string, attempts: Record<string, unknown>[]) => {
  let lastErr: { message: string } | null = null;
  for (const row of attempts) {
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null));
    const { data, error } = await db.from(table).insert([clean]).select('id');
    if (!error) return { data: data || [], error: null };
    lastErr = { message: error.message };
  }
  return { data: [] as any[], error: lastErr };
};

export async function insertPendingDepositTopup(
  db: Db,
  row: {
    customer_phone: string;
    customer_name?: string;
    outlet_id?: string;
    package_name: string;
    amount: number;
    balance_added: number;
    mayar_payment_id?: string;
    mayar_invoice_url?: string;
    receipt?: string;
    payment_method?: string;
  }
) {
  const bonus = depositBonusOf({ pay: row.amount, credit: row.balance_added });
  return insertAttempts(db, 'deposit_topups', [
    {
      customer_phone: row.customer_phone,
      customer_name: row.customer_name || 'Pelanggan',
      outlet_id: row.outlet_id || null,
      package_name: row.package_name,
      amount: row.amount,
      balance_added: row.balance_added,
      bonus,
      status: 'PENDING',
      payment_method: row.payment_method || 'QRIS Mayar',
      mayar_payment_id: row.mayar_payment_id,
      mayar_invoice_url: row.mayar_invoice_url,
      receipt: row.receipt
    },
    {
      customer_phone: row.customer_phone,
      package_name: row.package_name,
      amount: row.amount,
      balance_added: row.balance_added,
      status: 'PENDING',
      mayar_payment_id: row.mayar_payment_id,
      receipt: row.receipt
    },
    {
      customer_phone: row.customer_phone,
      package_name: row.package_name,
      amount: row.amount,
      status: 'PENDING',
      mayar_payment_id: row.mayar_payment_id
    }
  ]);
}

export async function findDepositTopup(
  db: Db,
  refs: { topupId?: string; paymentId?: string; receipt?: string; mobile?: string }
) {
  try {
  if (refs.topupId) {
    const { data } = await db.from('deposit_topups').select('*').eq('id', refs.topupId).maybeSingle();
    if (data) return data;
  }
  if (refs.paymentId) {
    const { data } = await db.from('deposit_topups').select('*').eq('mayar_payment_id', refs.paymentId).limit(1);
    if (data?.[0]) return data[0];
  }
  if (refs.receipt && /^DEP-/i.test(refs.receipt)) {
    const { data } = await db.from('deposit_topups').select('*').eq('receipt', refs.receipt).order('created_at', { ascending: false }).limit(1);
    if (data?.[0]) return data[0];
  }
  if (refs.mobile) {
    const { data } = await db
      .from('deposit_topups')
      .select('*')
      .in('customer_phone', phonesOf(refs.mobile))
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
  } catch {
    return null;
  }
}

export async function creditDepositTopup(
  db: Db,
  topup: any,
  opts?: { agentName?: string }
) {
  const status = String(topup?.status || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'LUNAS' || status === 'PAID') {
    return { error: null, already: true, balance: null as number | null };
  }

  const phone = normalizeCustomerPhone(topup.customer_phone || '');
  const variants = phonesOf(topup.customer_phone || phone);
  const pkg = depositPackageOf(topup.package_name);
  const paid = Number(topup.amount || pkg?.pay || 0);
  const credit = Number(topup.balance_added || pkg?.credit || paid);
  const name = topup.customer_name || 'Pelanggan';
  const agent = opts?.agentName || 'Mayar QRIS';

  const paymentId = String(topup?.mayar_payment_id || topup?.id || '').trim();
  const credited = await creditCustomerDeposit(db, phone || variants[0] || '', credit, paymentId);
  if (credited.error) return { error: credited.error, already: false, balance: null };
  const nextBal = credited.balance;
  const { data: existing } = await db.from('customers').select('phone, name').in('phone', variants.length ? variants : [phone]).limit(1);
  const targetPhone = existing?.[0]?.phone || phone;
  if (existing?.[0] && name && existing[0].name !== name) {
    await db.from('customers').update({ name }).eq('phone', targetPhone);
  }

  if (topup.id) {
    const paidAt = new Date().toISOString();
    const attempts = [
      { status: 'SUCCESS', paid_at: paidAt, payment_method: 'QRIS Mayar' },
      { status: 'SUCCESS', payment_method: 'QRIS Mayar' },
      { status: 'SUCCESS' }
    ];
    for (const patch of attempts) {
      const { error } = await db.from('deposit_topups').update(patch).eq('id', topup.id);
      if (!error) break;
    }
  }

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: dup } = await db
    .from('membership_logs')
    .select('id')
    .eq('customer_phone', targetPhone)
    .eq('price', paid)
    .eq('processed_by', agent)
    .gte('created_at', since)
    .limit(1);

  if (!dup?.[0]) {
    await insertAttempts(db, 'membership_logs', [
      {
        outlet_id: topup.outlet_id || null,
        processed_by: agent,
        commission_owner: agent,
        customer_phone: targetPhone,
        package_name: depositIncomeTitle(topup),
        price: paid,
        balance_added: credit,
        commission: 0,
        order_type: 'Online'
      },
      {
        processed_by: agent,
        customer_phone: targetPhone,
        package_name: depositIncomeTitle(topup),
        price: paid,
        balance_added: credit,
        order_type: 'Online'
      },
      {
        customer_phone: targetPhone,
        package_name: depositIncomeTitle(topup),
        price: paid,
        balance_added: credit
      }
    ]);
  }

  return { error: null, already: false, balance: nextBal };
}
