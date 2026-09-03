'use client';

import { useEffect, useState } from 'react';
import StaffWorkspace from '@/components/StaffWorkspace';
import { getStaffSession, homePathForRole, isCsRole, isWorkspaceRole } from '@/lib/staffSession';

export default function WorkspacePage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = getStaffSession().role;
    if (isCsRole(role)) {
      window.location.href = '/cs/workspace';
      return;
    }
    if (!isWorkspaceRole(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
  }, []);

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;
  return <StaffWorkspace />;
}
