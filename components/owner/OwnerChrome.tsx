'use client';

import { useEffect, useState, type ReactNode } from 'react';
import OwnerSidebar, { OwnerBellButton, OwnerMenuButton } from '@/components/owner/OwnerSidebar';
import { ownerHref, type SettingsPanel } from '@/components/owner/ownerNav';
import { useOwnerDeleteNotifs } from '@/components/owner/useOwnerDeleteNotifs';
import { canAccessSettings, isOwnerRole } from '@/lib/staffSession';

type Props = {
  activeTab: string;
  settingsPanel?: SettingsPanel;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
};

export default function OwnerChrome({
  activeTab,
  settingsPanel = 'services',
  eyebrow = 'Owner Analytics',
  title,
  subtitle,
  extra
}: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(activeTab === 'settings');
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

  const handleLogout = () => {
    localStorage.removeItem('laundry_owner_user');
    localStorage.removeItem('laundry_user');
    window.location.href = '/login';
  };

  return (
    <>
      <OwnerSidebar
        open={navOpen}
        onClose={() => setNavOpen(false)}
        activeTab={activeTab}
        settingsPanel={settingsPanel}
        settingsExpanded={settingsExpanded}
        onToggleSettings={() => setSettingsExpanded((v) => !v)}
        onGo={(tab, panel) => {
          window.location.href = ownerHref(tab, panel);
        }}
        canSettings={canAccessSettings(role) || isOwnerRole(role)}
        isOwner={isOwnerRole(role)}
        onLogout={handleLogout}
      />
      <div className="bg-white border border-slate-200/80 p-4 md:p-5 rounded-2xl shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <OwnerMenuButton onClick={() => setNavOpen(true)} />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">{eyebrow}</p>
              <h1 className="text-lg md:text-2xl font-black tracking-tight text-slate-900 truncate">{title}</h1>
              <p className="text-xs text-slate-400">
                {subtitle || (
                  <>
                    {userName || 'Owner'} · <span className="font-bold text-slate-600 uppercase">{role || '…'}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <OwnerBellButton
            count={unread}
            onClick={() => {
              window.location.href = ownerHref('delete_requests');
            }}
          />
        </div>
        {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
      </div>
    </>
  );
}
