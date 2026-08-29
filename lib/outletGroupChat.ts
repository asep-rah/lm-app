/** Akses Grup Koordinasi Outlet (`internal_outlet_chats`). */

const ALLOWED = new Set([
  'kasir',
  'pos',
  'cs',
  'cs_care',
  'head_cs',
  'supervisor',
  'finance',
  'head_finance',
  'admin_ops',
  'admin',
  'owner'
]);

const EXCLUDED = new Set(['driver', 'courier', 'kurir']);

const SWITCHER = new Set([
  'cs',
  'cs_care',
  'head_cs',
  'supervisor',
  'finance',
  'head_finance',
  'admin_ops',
  'admin',
  'owner'
]);

export const canAccessOutletGroupChat = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  if (EXCLUDED.has(r)) return false;
  return ALLOWED.has(r);
};

/** Kasir terkunci ke 1 outlet; CS / Supervisor / Finance / Admin Ops / Owner bisa ganti cabang. */
export const canSwitchOutletGroupChat = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  if (!canAccessOutletGroupChat(r)) return false;
  return SWITCHER.has(r);
};
