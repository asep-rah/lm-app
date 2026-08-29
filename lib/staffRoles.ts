/** Daftar peran staf untuk form karyawan, login, dan workspace. */

export type StaffRoleValue =
  | 'kasir'
  | 'driver'
  | 'cs'
  | 'cs_care'
  | 'admin_ops'
  | 'digital_marketing'
  | 'finance'
  | 'owner_relation'
  | 'supervisor'
  | 'head_management'
  | 'investor'
  | 'owner';

export const STAFF_ROLES: { value: StaffRoleValue; label: string }[] = [
  { value: 'kasir', label: 'Kasir (POS - 1 Outlet)' },
  { value: 'driver', label: 'Driver / Kurir (Aplikasi Kurir)' },
  { value: 'cs', label: 'Customer Service (CS Pusat)' },
  { value: 'cs_care', label: 'CS Care (Resolusi Komplain)' },
  { value: 'admin_ops', label: 'Admin Operasional / CMS' },
  { value: 'digital_marketing', label: 'Digital Marketing' },
  { value: 'finance', label: 'Finance (Multi-Outlet)' },
  { value: 'owner_relation', label: 'Owner Relation' },
  { value: 'supervisor', label: 'Supervisor (Multi-Outlet)' },
  { value: 'head_management', label: 'Head Management / Delegator' },
  { value: 'investor', label: 'Investor (Multi-Outlet Read Only)' },
  { value: 'owner', label: 'Owner (Full Akses)' }
];

export const staffRolesForForm = (includeOwner: boolean) =>
  STAFF_ROLES.filter((r) => includeOwner || r.value !== 'owner');

/** Role yang outlet-nya pusat / multi-cabang (bukan 1 toko kasir). */
export const isMultiOutletRole = (role: string) =>
  [
    'investor',
    'owner',
    'supervisor',
    'finance',
    'admin_ops',
    'admin',
    'digital_marketing',
    'owner_relation',
    'head_management',
    'head',
    'cs',
    'cs_care',
    'head_cs'
  ].includes(String(role || '').toLowerCase());

export const roleLabelOf = (role: string) =>
  STAFF_ROLES.find((r) => r.value === String(role || '').toLowerCase())?.label ||
  String(role || 'staf');
