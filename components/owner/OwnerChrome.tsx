'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { OwnerBellButton } from '@/components/owner/OwnerSidebar';
import OwnerHeaderBrand from '@/components/owner/OwnerHeaderBrand';
import { ownerHref, type SettingsPanel } from '@/components/owner/ownerNav';
import { useOwnerDeleteNotifs } from '@/components/owner/useOwnerDeleteNotifs';

type Props = {
  activeTab: string;
  settingsPanel?: SettingsPanel;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
};

export default function OwnerChrome({
  eyebrow = 'Owner Analytics',
  title,
  subtitle,
  extra
}: Props) {
  const [role, setRole] = useState('');
  const [userName, setUserName] = useState('');
  const { unread } = useOwnerDeleteNotifs();

  useEffect(() => {
    try {
      const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
      if (!raw) return;
      const user = JSON.parse(raw);
      setRole(String(user.role || '').toLowerCase());
      setUserName(String(user.name || ''));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="bg-white border border-slate-200/80 p-4 md:p-5 rounded-2xl shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <OwnerHeaderBrand
          eyebrow={eyebrow}
          title={title}
          subtitle={
            subtitle || (
              <>
                {userName || 'Owner'} · <span className="font-bold text-slate-600 uppercase">{role || '…'}</span>
              </>
            )
          }
        />
        <OwnerBellButton
          count={unread}
          onClick={() => {
            window.location.href = ownerHref('delete_requests');
          }}
        />
      </div>
      {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
    </div>
  );
}
