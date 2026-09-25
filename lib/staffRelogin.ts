import { clearStaffServerSession } from '@/lib/staffSession';

/**
 * Staff logs in again: the browser login lasts for days, the signed security
 * cookie only 12 h. Clear both so /login issues a fresh cookie.
 */
export const staffRelogin = () => {
  if (typeof window === 'undefined') return;
  clearStaffServerSession();
  for (const k of ['laundry_user', 'laundry_owner_user', 'laundry_driver_user', 'staff_role', 'user_id']) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  window.location.replace('/login');
};

export const isStaffSessionError = (data: unknown) => (data as { code?: string } | null)?.code === 'STAFF_SESSION_REQUIRED';
