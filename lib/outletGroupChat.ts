/** Akses Grup Koordinasi Outlet (`internal_outlet_chats`). Internal staff only. */

const ALLOWED = new Set([
  'owner',
  'cashier',
  'kasir',
  'pos',
  'operator',
  'supervisor',
  'courier',
  'driver',
  'kurir',
  'admin',
  'admin_ops',
  'cs',
  'cs_care',
  'head_cs',
  'finance',
  'head_finance'
]);

const CUSTOMER_ROLES = new Set(['customer', 'pelanggan', 'member', 'guest']);

const CUSTOMER_PATH_PREFIXES = [
  '/customer',
  '/deposit',
  '/aktivitas',
  '/beranda',
  '/profil',
  '/order'
];

export const isCustomerRole = (role: string) =>
  CUSTOMER_ROLES.has(String(role || '').toLowerCase().trim());

export const isCustomerFacingPath = (pathname?: string | null) => {
  const p = String(pathname || '').toLowerCase().split('?')[0];
  if (!p) return false;
  return CUSTOMER_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
};

export const canAccessOutletGroupChat = (role: string, pathname?: string | null) => {
  if (isCustomerFacingPath(pathname)) return false;
  const r = String(role || '').toLowerCase().trim();
  if (!r || isCustomerRole(r)) return false;
  return ALLOWED.has(r);
};

/** Kasir terkunci ke 1 outlet; CS / Supervisor / Finance / Admin Ops / Owner bisa ganti cabang. */
export const canSwitchOutletGroupChat = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  if (!canAccessOutletGroupChat(r)) return false;
  return ['cs', 'cs_care', 'head_cs', 'supervisor', 'finance', 'head_finance', 'admin_ops', 'admin', 'owner'].includes(r);
};
