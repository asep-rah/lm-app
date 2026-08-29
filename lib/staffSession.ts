export type StaffSession = {
  id: string;
  name: string;
  role: string;
  outletId: string;
};

export const getStaffSession = (): StaffSession => {
  if (typeof window === 'undefined') {
    return { id: '', name: 'Karyawan', role: 'kasir', outletId: '' };
  }

  try {
    const raw =
      localStorage.getItem('laundry_owner_user') ||
      localStorage.getItem('laundry_user');
    const u = raw ? JSON.parse(raw) : {};
    const metaOutlet = u.user_metadata?.outlet_id || u.raw_user_meta_data?.outlet_id;
    const storedOutlet =
      localStorage.getItem('user_outlet_id') || localStorage.getItem('outlet_id') || '';
    return {
      id: String(u.id || u.username || u.name || ''),
      name: String(u.name || u.username || 'Karyawan'),
      role: String(u.role || 'kasir').toLowerCase().trim(),
      outletId: String(u.outlet_id || metaOutlet || storedOutlet || '')
    };
  } catch {
    return { id: '', name: 'Karyawan', role: 'kasir', outletId: '' };
  }
};

export const isOwnerRole = (role: string) =>
  ['owner'].includes(String(role || '').toLowerCase());

export const isHeadManagementRole = (role: string) =>
  ['head', 'head_management'].includes(String(role || '').toLowerCase());

export const isSupervisorRole = (role: string) =>
  ['supervisor', 'owner'].includes(String(role || '').toLowerCase());

/** Kasir/POS hanya boleh melihat dan mengubah pesanan outlet sendiri. */
export const isOutletLockedRole = (role: string) =>
  ['kasir', 'pos'].includes(String(role || '').toLowerCase().trim());

/** CS / CS Care / Head CS — workspace live chat, bukan POS. */
export const isCsRole = (role: string) =>
  ['cs', 'cs_care', 'head_cs'].includes(String(role || '').toLowerCase().trim());

/** Settings / Pengaturan outlet & karyawan: Owner & Supervisor. */
export const canAccessSettings = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  return r === 'owner' || r === 'supervisor';
};

/** Target KPI hanya Owner yang boleh melihat dan mengubah. */
export const canAccessKpiSettings = (role: string) => isOwnerRole(role);

/** Dashboard workspace (bukan POS, bukan Driver, bukan Owner analytics). */
export const isWorkspaceRole = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  return [
    'admin_ops',
    'admin',
    'digital_marketing',
    'finance',
    'head_finance',
    'owner_relation',
    'cs',
    'head_cs',
    'supervisor',
    'head',
    'head_management'
  ].includes(r);
};

/** Finance dipetakan ke Admin Ops karena belum ada role terpisah di login. */
export const isAdminOpsRole = (role: string) =>
  ['finance', 'admin_ops', 'admin', 'head_finance', 'owner'].includes(role);

/** Purchase Request (CMS) hanya Kasir / POS yang boleh mengajukan. */
export const canCreateRequisition = (role: string) =>
  ['kasir', 'pos'].includes(String(role || '').toLowerCase().trim());

/** Dashboard tujuan jika role tidak boleh membuka rute Owner / settings. */
export const homePathForRole = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  if (isOwnerRole(r)) return '/owner';
  if (r === 'cs_care') return '/cs/care';
  if (isWorkspaceRole(r)) return '/workspace';
  if (['driver', 'courier', 'kurir'].includes(r)) return '/driver/dashboard';
  if (r === 'investor') return '/investor';
  if (r === 'kasir' || r === 'pos') return '/pos';
  return '/login';
};

/**
 * Kartu KPI yang boleh dilihat role ini.
 * Owner/Head = semua; Supervisor = Kasir + Supervisor; lainnya = kartu sendiri.
 */
export const kpiKeysVisibleForRole = (role: string): string[] | null => {
  const r = String(role || '').toLowerCase().trim();
  if (isOwnerRole(r) || isHeadManagementRole(r)) return null;
  if (r === 'supervisor') return ['kasir', 'supervisor'];
  if (r === 'kasir' || r === 'pos') return ['kasir'];
  if (['cs', 'head_cs', 'cs_care', 'driver', 'courier', 'kurir'].includes(r)) return ['kurir_cs'];
  if (['finance', 'head_finance'].includes(r)) return ['finance'];
  if (['admin_ops', 'admin'].includes(r)) return ['admin_ops'];
  if (r === 'digital_marketing') return ['digital_marketing'];
  if (r === 'owner_relation') return ['owner_relation'];
  return ['kasir'];
};
