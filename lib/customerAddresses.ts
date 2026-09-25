/**
 * Saved pickup addresses of the customer. Read and written through
 * /api/customer/addresses (the browser key can no longer write
 * customer_addresses); localStorage keeps a copy for offline / first paint.
 */

export type SavedAddress = {
  id: string;
  label: string;
  full_address: string;
  is_primary: boolean;
  latitude?: number | null;
  longitude?: number | null;
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
  is_primary: row.is_primary === true || row.is_primary === 'true',
  latitude: row.latitude == null || row.latitude === '' ? null : Number(row.latitude),
  longitude: row.longitude == null || row.longitude === '' ? null : Number(row.longitude)
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

const ENDPOINT = '/api/customer/addresses';

/** Server list, or null when the server could not be reached / refused. */
async function callServer(phone: string, body?: Record<string, unknown>): Promise<SavedAddress[] | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : { 'x-customer-phone': phone },
      body: body ? JSON.stringify({ ...body, phone }) : undefined
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.addresses) ? (data.addresses as Record<string, unknown>[]).map(mapRow) : null;
  } catch {
    return null;
  }
}

export async function loadCustomerAddresses(phone: string): Promise<SavedAddress[]> {
  const local = readLocal(phone);
  if (!phone) return local;
  const remote = await callServer(phone);
  if (!remote || !remote.length) return local;
  writeLocal(phone, remote);
  return remote;
}

export async function upsertCustomerAddress(
  phone: string,
  current: SavedAddress[],
  draft: {
    id?: string;
    label: string;
    full_address: string;
    is_primary?: boolean;
    latitude?: number | null;
    longitude?: number | null;
  }
): Promise<SavedAddress[]> {
  const label = String(draft.label || 'Alamat').trim() || 'Alamat';
  const full_address = String(draft.full_address || '').trim();
  if (!full_address) return current;

  // Optimistic local copy first (works offline / before login).
  const id = draft.id || newId();
  const makePrimary = draft.is_primary === true || current.length === 0;
  const nextRow: SavedAddress = {
    id,
    label,
    full_address,
    is_primary: makePrimary,
    latitude: draft.latitude ?? null,
    longitude: draft.longitude ?? null
  };
  const without = current.filter((r) => r.id !== draft.id && r.id !== id);
  const next = withSinglePrimary([...without, nextRow], makePrimary ? id : undefined);
  writeLocal(phone, next);
  if (!phone) return next;

  const remote = await callServer(phone, {
    action: 'save',
    address: { id: draft.id, label, full_address, is_primary: nextRow.is_primary, latitude: nextRow.latitude, longitude: nextRow.longitude }
  });
  if (!remote) return next;
  writeLocal(phone, remote);
  return remote;
}

export async function removeCustomerAddress(phone: string, current: SavedAddress[], id: string): Promise<SavedAddress[]> {
  const remaining = withSinglePrimary(current.filter((r) => r.id !== id));
  writeLocal(phone, remaining);
  if (!phone || !id || id.startsWith('local_') || id.startsWith('addr_')) return remaining;
  const remote = await callServer(phone, { action: 'delete', id });
  if (!remote) return remaining;
  writeLocal(phone, remote);
  return remote;
}

export async function setPrimaryCustomerAddress(
  phone: string,
  current: SavedAddress[],
  id: string
): Promise<SavedAddress[]> {
  const next = withSinglePrimary(current, id);
  writeLocal(phone, next);
  if (!phone) return next;
  const remote = await callServer(phone, { action: 'primary', id });
  if (!remote) return next;
  writeLocal(phone, remote);
  return remote;
}
