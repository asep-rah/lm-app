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

export const isOwnerRole = (role: string) => role === 'owner';

export const isSupervisorRole = (role: string) =>
  ['supervisor', 'owner'].includes(role);

/** Finance dipetakan ke Admin Ops karena belum ada role terpisah di login. */
export const isAdminOpsRole = (role: string) =>
  ['finance', 'admin_ops', 'admin', 'head_finance', 'owner'].includes(role);

export const canCreateRequisition = (role: string) =>
  !['investor'].includes(role);
