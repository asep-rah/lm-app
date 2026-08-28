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
    return {
      id: String(u.id || u.username || u.name || ''),
      name: String(u.name || u.username || 'Karyawan'),
      role: String(u.role || 'kasir').toLowerCase().trim(),
      outletId: String(u.outlet_id || '')
    };
  } catch {
    return { id: '', name: 'Karyawan', role: 'kasir', outletId: '' };
  }
};

export const isOwnerRole = (role: string) =>
  ['owner', 'head', 'head_management'].includes(String(role || '').toLowerCase());

export const isSupervisorRole = (role: string) =>
  ['supervisor', 'owner'].includes(String(role || '').toLowerCase());

/** Finance dipetakan ke Admin Ops karena belum ada role terpisah di login. */
export const isAdminOpsRole = (role: string) =>
  ['finance', 'admin_ops', 'admin', 'head_finance', 'owner'].includes(role);

export const canCreateRequisition = (role: string) =>
  !['investor'].includes(role);

/** Dashboard tujuan jika role tidak boleh membuka rute Owner. */
export const homePathForRole = (role: string) => {
  const r = String(role || '').toLowerCase().trim();
  if (
    isOwnerRole(r) ||
    r === 'supervisor' ||
    r === 'finance' ||
    r === 'head_finance' ||
    r === 'admin_ops' ||
    r === 'admin'
  ) {
    return '/owner';
  }
  if (r === 'cs' || r === 'head_cs') return '/cs';
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
  if (isOwnerRole(r)) return null;
  if (r === 'supervisor') return ['kasir', 'supervisor'];
  if (r === 'kasir' || r === 'pos') return ['kasir'];
  if (['cs', 'head_cs', 'driver', 'courier', 'kurir'].includes(r)) return ['kurir_cs'];
  if (['finance', 'head_finance'].includes(r)) return ['finance'];
  if (['admin_ops', 'admin'].includes(r)) return ['admin_ops'];
  if (r === 'digital_marketing') return ['digital_marketing'];
  return ['kasir'];
};
