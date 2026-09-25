/**
 * Server rules for a customer's saved addresses (customer_addresses), written
 * only by /api/customer/addresses with the service role. The browser key can
 * no longer insert/update/delete this table (migration
 * 20261004_customer_addresses_server_only.sql).
 *
 * Pure: validation + row mapping. Ownership (customer_phone) is enforced by
 * the route with lib/phone lookup keys.
 */
import { toLatLon } from '@/lib/serviceArea';

export const MAX_ADDRESSES_PER_CUSTOMER = 20;
export const ADDRESS_COLUMNS = 'id, customer_phone, label_name, full_address, is_primary, latitude, longitude, created_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isAddressId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const str = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export type AddressDraft = {
  /** Existing row to update; absent for a new address. */
  id: string | null;
  label_name: string;
  full_address: string;
  is_primary: boolean;
  latitude: number | null;
  longitude: number | null;
};

export type AddressCheck = { ok: true; draft: AddressDraft } | { ok: false; error: string };

export function validateAddressDraft(input: unknown): AddressCheck {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const full = str(b.full_address, 500);
  if (full.length < 5) return { ok: false, error: 'Alamat terlalu pendek.' };
  const hasLat = b.latitude != null && b.latitude !== '';
  const hasLon = b.longitude != null && b.longitude !== '';
  let lat: number | null = null;
  let lon: number | null = null;
  if (hasLat || hasLon) {
    const pt = toLatLon(b.latitude, b.longitude);
    if (!pt) return { ok: false, error: 'Titik peta tidak valid.' };
    lat = pt.lat;
    lon = pt.lon;
  }
  // Client-generated ids for rows never saved on the server ("local_…", "addr_…") are new rows.
  const id = isAddressId(b.id) ? b.id : null;
  return {
    ok: true,
    draft: {
      id,
      label_name: str(b.label ?? b.label_name, 40) || 'Alamat',
      full_address: full,
      is_primary: b.is_primary === true,
      latitude: lat,
      longitude: lon
    }
  };
}

type Row = Record<string, unknown>;

/** Same shape as lib/customerAddresses SavedAddress; exactly one primary. */
export function toSavedAddresses(rows: Row[]) {
  const list = (rows || [])
    .map((r) => ({
      id: String(r.id),
      label: String(r.label_name || 'Alamat').trim() || 'Alamat',
      full_address: String(r.full_address || '').trim(),
      is_primary: r.is_primary === true,
      latitude: r.latitude == null || r.latitude === '' ? null : Number(r.latitude),
      longitude: r.longitude == null || r.longitude === '' ? null : Number(r.longitude),
      created_at: String(r.created_at || '')
    }))
    .filter((a) => a.full_address)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const primaryId = list.find((a) => a.is_primary)?.id || list[0]?.id;
  return list.map((a) => ({
    id: a.id,
    label: a.label,
    full_address: a.full_address,
    is_primary: a.id === primaryId,
    latitude: a.latitude,
    longitude: a.longitude
  }));
}
