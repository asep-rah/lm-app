/**
 * Aturan akses foto item satuan (pure, server-side only — tanpa I/O).
 *
 * - Path objek selalu dibuat server: `<folder pemilik>/<yyyy-mm>/<uuid>.jpg`.
 *   Folder pemilik = HMAC nomor HP customer (bukan nomor HP mentah), jadi
 *   path tidak membocorkan nomor HP dan tidak bisa ditebak.
 * - Staf hanya boleh membuka foto yang (1) tercantum di items[].pieces[] pada
 *   pesanan yang diminta DAN (2) berada di folder milik nomor HP pesanan itu,
 *   supaya pesanan tidak bisa "meminjam" foto pelanggan lain.
 */
import { createHmac, randomUUID } from 'crypto';
import { localPhone08 } from '@/lib/customerAuth/core';

export const SATUAN_PHOTO_VIEW_ROLES = new Set([
  'kasir',
  'cashier',
  'pos',
  'cs',
  'cs_care',
  'head_cs',
  'owner',
  'supervisor',
  'admin_ops',
  'admin'
]);

/** Kasir/POS terkunci ke outlet sendiri (sama dengan isOutletLockedRole di lib/staffSession). */
export const SATUAN_PHOTO_OUTLET_LOCKED_ROLES = new Set(['kasir', 'cashier', 'pos']);

export const SATUAN_PHOTO_VIEW_TTL_SEC = 300;
export const SATUAN_PHOTO_UPLOAD_MAX_PER_HOUR = 40;

const PATH_RE = /^[a-f0-9]{32}\/\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

export const satuanPhotoOwnerFolder = (phone: string, secret: string): string => {
  const canon = localPhone08(phone);
  if (!canon || !secret) return '';
  return createHmac('sha256', secret).update(`satuan-photo-owner\u0000${canon}`).digest('hex').slice(0, 32);
};

export const newSatuanPhotoPath = (ownerFolder: string, now = new Date(), uuid = randomUUID()): string => {
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${ownerFolder}/${ym}/${uuid}.jpg`;
};

export const isValidSatuanPhotoPath = (path: unknown): path is string =>
  typeof path === 'string' && PATH_RE.test(path);

/** Semua photo_path yang tercantum di pickup_orders.items (array atau string JSON). */
export const photoPathsOfPickupItems = (items: unknown): Set<string> => {
  let list: unknown = items;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return new Set();
    }
  }
  const out = new Set<string>();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const pieces = (item as { pieces?: unknown })?.pieces;
    if (!Array.isArray(pieces)) continue;
    for (const piece of pieces) {
      const p = (piece as { photo_path?: unknown })?.photo_path;
      if (isValidSatuanPhotoPath(p)) out.add(p);
    }
  }
  return out;
};

export type PickupOrderForPhoto = {
  items?: unknown;
  customer_phone?: string | null;
  phone_number?: string | null;
  outlet_id?: string | null;
};

export const photoBelongsToOrder = (path: string, order: PickupOrderForPhoto, secret: string): boolean => {
  if (!isValidSatuanPhotoPath(path)) return false;
  if (!photoPathsOfPickupItems(order.items).has(path)) return false;
  const folder = satuanPhotoOwnerFolder(String(order.customer_phone || order.phone_number || ''), secret);
  return Boolean(folder) && path.startsWith(`${folder}/`);
};

export type StaffForPhoto = {
  role?: string | null;
  outlet_id?: string | null;
  access_outlets?: unknown;
  assigned_outlet_ids?: unknown;
};

const idList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      return v.split(',').map((x) => x.trim()).filter(Boolean);
    }
  }
  return [];
};

/** Peran staf (dari DB, bukan dari token) boleh melihat foto pesanan ini? */
export const staffMayViewOrderPhoto = (staff: StaffForPhoto, order: PickupOrderForPhoto): boolean => {
  const role = String(staff.role || '').toLowerCase().trim();
  if (!SATUAN_PHOTO_VIEW_ROLES.has(role)) return false;
  if (!SATUAN_PHOTO_OUTLET_LOCKED_ROLES.has(role)) return true;
  const orderOutlet = String(order.outlet_id || '');
  if (!orderOutlet) return false;
  const allowed = new Set([String(staff.outlet_id || ''), ...idList(staff.access_outlets), ...idList(staff.assigned_outlet_ids)]);
  allowed.delete('');
  return allowed.has(orderOutlet);
};
