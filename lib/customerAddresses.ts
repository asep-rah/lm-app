import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { supabase } from '@/lib/supabaseClient';

export type SavedAddress = {
  id: string;
  label: string;
  full_address: string;
  is_primary: boolean;
};

export const ADDRESS_LABEL_PRESETS = ['Rumah', 'Kantor', 'Apartemen'] as const;

const listKey = (phone: string) => `laundry_customer_addresses_${phone}`;
const PRIMARY_KEY = 'laundry_customer_address';

const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `addr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const mapRow = (row: Record<string, unknown>): SavedAddress => ({
  id: String(row.id || newId()),
  label: String(row.label_name || row.label || 'Alamat').trim() || 'Alamat',
  full_address: String(row.full_address || row.address || '').trim(),
  is_primary: row.is_primary === true || row.is_primary === 'true'
});

const readLocal = (phone: string): SavedAddress[] => {
  if (typeof window === 'undefined' || !phone) return [];
  try {
    const raw = localStorage.getItem(listKey(phone));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((r) => mapRow(r)).filter((a) => a.full_address);
    }
  } catch {
    /* ignore */
  }
  const legacy = String(localStorage.getItem(PRIMARY_KEY) || '').trim();
  if (!legacy) return [];
  return [{ id: `local_${phone}`, label: 'Rumah', full_address: legacy, is_primary: true }];
};

const writeLocal = (phone: string, rows: SavedAddress[]) => {
  if (typeof window === 'undefined' || !phone) return;
  localStorage.setItem(listKey(phone), JSON.stringify(rows));
  const primary = rows.find((r) => r.is_primary) || rows[0];
  if (primary?.full_address) localStorage.setItem(PRIMARY_KEY, primary.full_address);
  else localStorage.removeItem(PRIMARY_KEY);
};

const withSinglePrimary = (rows: SavedAddress[], primaryId?: string) => {
  const target = primaryId || rows.find((r) => r.is_primary)?.id || rows[0]?.id;
  return rows.map((r) => ({ ...r, is_primary: r.id === target }));
};

export const primaryAddressOf = (rows: SavedAddress[]) =>
  rows.find((r) => r.is_primary)?.full_address || rows[0]?.full_address || '';

export async function loadCustomerAddresses(phone: string): Promise<SavedAddress[]> {
  const local = readLocal(phone);
  if (!phone) return local;
  try {
    const { data, error } = await supabase
      .from('customer_addresses')
      .select('id, customer_phone, label_name, full_address, is_primary')
      .eq('customer_phone', phone)
      .order('created_at', { ascending: true });
    if (error || !data) return local;
    const remote = (data as Record<string, unknown>[]).map(mapRow).filter((a) => a.full_address);
    if (!remote.length) return local;
    const merged = withSinglePrimary(remote);
    writeLocal(phone, merged);
    return merged;
  } catch {
    return local;
  }
}

export async function upsertCustomerAddress(
  phone: string,
  current: SavedAddress[],
  draft: { id?: string; label: string; full_address: string; is_primary?: boolean }
): Promise<SavedAddress[]> {
  const label = String(draft.label || 'Alamat').trim() || 'Alamat';
  const full_address = String(draft.full_address || '').trim();
  if (!full_address) return current;

  const isNew = !draft.id || draft.id.startsWith('local_') || draft.id.startsWith('addr_');
  const id = isNew ? newId() : String(draft.id);
  const makePrimary = draft.is_primary === true || current.length === 0;
  const nextRow: SavedAddress = { id, label, full_address, is_primary: makePrimary };
  const without = current.filter((r) => r.id !== draft.id && r.id !== id);
  const next = withSinglePrimary([...without, nextRow], makePrimary ? id : undefined);
  writeLocal(phone, next);

  if (!phone) return next;

  const payload = {
    id,
    customer_phone: phone,
    label_name: label,
    full_address,
    is_primary: nextRow.is_primary
  };

  if (isNew) {
    await insertWithFallback('customer_addresses', [
      payload,
      { customer_phone: phone, label_name: label, full_address, is_primary: nextRow.is_primary },
      { customer_phone: phone, full_address, is_primary: nextRow.is_primary }
    ]);
  } else {
    await updateWithFallback(
      'customer_addresses',
      [
        { label_name: label, full_address, is_primary: nextRow.is_primary },
        { full_address, is_primary: nextRow.is_primary },
        { full_address }
      ],
      { column: 'id', value: id }
    );
  }

  if (nextRow.is_primary) {
    await Promise.all(
      next
        .filter((r) => r.id !== id)
        .map((r) =>
          updateWithFallback('customer_addresses', [{ is_primary: false }], { column: 'id', value: r.id })
        )
    );
  }

  return next;
}

export async function removeCustomerAddress(phone: string, current: SavedAddress[], id: string): Promise<SavedAddress[]> {
  const remaining = withSinglePrimary(current.filter((r) => r.id !== id));
  writeLocal(phone, remaining);
  if (phone && id && !id.startsWith('local_')) {
    try {
      await supabase.from('customer_addresses').delete().eq('id', id);
    } catch {
      /* ignore */
    }
  }
  const newPrimary = remaining.find((r) => r.is_primary);
  if (newPrimary && phone) {
    await updateWithFallback('customer_addresses', [{ is_primary: true }], { column: 'id', value: newPrimary.id });
  }
  return remaining;
}

export async function setPrimaryCustomerAddress(
  phone: string,
  current: SavedAddress[],
  id: string
): Promise<SavedAddress[]> {
  const next = withSinglePrimary(current, id);
  writeLocal(phone, next);
  if (!phone) return next;
  await Promise.all(
    next.map((r) =>
      updateWithFallback('customer_addresses', [{ is_primary: r.is_primary }], { column: 'id', value: r.id })
    )
  );
  return next;
}
