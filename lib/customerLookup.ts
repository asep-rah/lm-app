import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { canonicalPhone, phoneVariants } from '@/lib/csChat';
import { supabase } from '@/lib/supabaseClient';

export type CustomerHit = {
  phone: string;
  name: string;
  deposit_balance?: number;
  source?: 'customers' | 'transactions';
};

const PLACEHOLDER_NAMES = new Set(['', 'pelanggan', 'customer', 'guest', '-']);

export const isPlaceholderCustomerName = (name: unknown) =>
  PLACEHOLDER_NAMES.has(String(name || '').trim().toLowerCase());

export const maskPhone = (phone: string) => {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return '••••';
  const last4 = d.slice(-4);
  if (d.startsWith('62') && d.length >= 10) return `08•••${last4}`;
  if (d.startsWith('0') && d.length >= 10) return `08•••${last4}`;
  return `••••${last4}`;
};

export async function findCustomerByPhone(phone: string): Promise<CustomerHit | null> {
  const variants = phoneVariants(phone);
  if (!variants.length) return null;
  const { data } = await supabase
    .from('customers')
    .select('phone, name, deposit_balance')
    .in('phone', variants)
    .limit(5);
  const row = (data || [])[0];
  if (row?.phone) {
    return {
      phone: String(row.phone),
      name: String(row.name || ''),
      deposit_balance: Number(row.deposit_balance) || 0,
      source: 'customers'
    };
  }

  // Fallback: pernah order tapi belum di tabel customers
  const { data: txs } = await supabase
    .from('transactions')
    .select('customer_phone, customer_name')
    .in('customer_phone', variants)
    .order('created_at', { ascending: false })
    .limit(5);
  const tx = (txs || []).find((t) => String(t.customer_phone || '').trim());
  if (!tx) return null;
  return {
    phone: String(tx.customer_phone),
    name: String(tx.customer_name || ''),
    deposit_balance: 0,
    source: 'transactions'
  };
}

/** Cari pelanggan by 4 digit terakhir nomor WA (untuk konfirmasi kasir). */
export async function searchCustomersByLast4(last4Raw: string): Promise<CustomerHit[]> {
  const last4 = String(last4Raw || '').replace(/\D/g, '');
  if (last4.length !== 4) return [];

  const hits = new Map<string, CustomerHit>();

  const { data: custRows } = await supabase
    .from('customers')
    .select('phone, name, deposit_balance')
    .like('phone', `%${last4}`)
    .limit(40);

  for (const row of custRows || []) {
    const phone = String(row.phone || '');
    const digits = phone.replace(/\D/g, '');
    if (!digits.endsWith(last4)) continue;
    const key = canonicalPhone(phone) || digits;
    if (!key || hits.has(key)) continue;
    hits.set(key, {
      phone,
      name: String(row.name || 'Pelanggan'),
      deposit_balance: Number(row.deposit_balance) || 0,
      source: 'customers'
    });
  }

  const { data: txRows } = await supabase
    .from('transactions')
    .select('customer_phone, customer_name')
    .like('customer_phone', `%${last4}`)
    .order('created_at', { ascending: false })
    .limit(60);

  for (const row of txRows || []) {
    const phone = String(row.customer_phone || '');
    const digits = phone.replace(/\D/g, '');
    if (!digits.endsWith(last4)) continue;
    const key = canonicalPhone(phone) || digits;
    if (!key || hits.has(key)) continue;
    const name = String(row.customer_name || '').trim();
    if (!name || isPlaceholderCustomerName(name)) continue;
    hits.set(key, {
      phone,
      name,
      deposit_balance: 0,
      source: 'transactions'
    });
  }

  return [...hits.values()].slice(0, 12);
}

/** Simpan / perbarui pelanggan otomatis setelah order. */
export async function upsertCustomerOnOrder(opts: {
  phone: string;
  name?: string;
  outletId?: string;
  registeredBy?: string;
}): Promise<{ error: { message: string } | null }> {
  const phone = canonicalPhone(opts.phone) || String(opts.phone || '').replace(/\D/g, '');
  const name = String(opts.name || '').trim();
  if (!phone || phone.length < 8) return { error: null };

  const existing = await findCustomerByPhone(phone);
  if (existing?.source === 'customers') {
    const shouldUpdateName =
      name &&
      !isPlaceholderCustomerName(name) &&
      (isPlaceholderCustomerName(existing.name) || existing.name !== name);
    if (shouldUpdateName) {
      const variants = phoneVariants(existing.phone || phone);
      await updateWithFallback('customers', [{ name }], {
        column: 'phone',
        value: existing.phone
      });
      // Best-effort: juga update varian nomor lain jika ada duplikat.
      for (const v of variants) {
        if (v === existing.phone) continue;
        await supabase.from('customers').update({ name }).eq('phone', v);
      }
    }
    return { error: null };
  }

  const insertName = name && !isPlaceholderCustomerName(name) ? name : 'Pelanggan';
  const { error } = await insertWithFallback('customers', [
    {
      phone,
      name: insertName,
      registered_by: opts.registeredBy || null,
      outlet_id: opts.outletId || null,
      deposit_balance: 0
    },
    { phone, name: insertName, registered_by: opts.registeredBy || null, deposit_balance: 0 },
    { phone, name: insertName }
  ]);
  return { error: error ? { message: error.message } : null };
}
