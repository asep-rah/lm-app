'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import OwnerSidebar from '@/components/owner/OwnerSidebar';
import OwnerBottomDock from '@/components/owner/OwnerBottomDock';
import { ownerHref, isRemoteOwnerTab, readOwnerSearch, OWNER_TAB_EVENT, type SettingsPanel } from '@/components/owner/ownerNav';
import { canAccessSettings, isOwnerRole } from '@/lib/staffSession';

function tabFromPath(pathname: string): string {
  const p = pathname.replace(/\/$/, '') || '/owner';
  if (p === '/owner' || p === '/owner/dashboard') return '';
  if (p.startsWith('/owner/system-health')) return 'system-health';
  if (p.startsWith('/owner/crm')) return 'crm';
  if (p.startsWith('/owner/vouchers')) return 'promos-voucher';
  if (p.startsWith('/owner/promos')) return 'promos';
  if (p.startsWith('/owner/delegasi')) return 'delegasi';
  if (p.startsWith('/owner/kpi-settings')) return 'kpi-settings';
  if (p.startsWith('/owner/kpi')) return 'kpi';
  if (p.startsWith('/owner/reports/laba-rugi')) return 'laba-rugi';
  if (p.startsWith('/owner/reports/jurnal')) return 'jurnal';
  if (p.startsWith('/owner/reports/buku-besar')) return 'buku-besar';
  if (p.startsWith('/owner/reports/perubahan-modal')) return 'perubahan-modal';
  if (p.startsWith('/owner/reports/neraca')) return 'neraca';
  if (p.startsWith('/owner/performance')) {
    if (typeof window === 'undefined') return 'performa-outlet';
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'layanan') return 'performa-layanan';
    if (view === 'karyawan') return 'performa-karyawan';
    if (view === 'pendapatan') return 'grafik-pendapatan';
    if (view === 'biaya') return 'grafik-biaya';
    if (view === 'promosi') return 'grafik-promosi';
    return 'performa-outlet';
  }
  if (p.startsWith('/owner/machines') || p.startsWith('/owner/settings/machines')) return 'settings';
  if (p.startsWith('/owner/settings/outlets')) return 'settings';
  return 'pnl';
}

/** Sidebar + dock bawah untuk semua rute `/owner/*`. */
export default function OwnerNavHost({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/owner';
  const searchParams = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [role, setRole] = useState('');
  const [activeTab, setActiveTab] = useState('pnl');
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>('services');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
      if (!raw) return;
      const user = JSON.parse(raw);
      setRole(String(user.role || '').toLowerCase());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const fromPath = tabFromPath(pathname);
    if (fromPath) {
      setActiveTab(fromPath);
      if (fromPath === 'settings') setSettingsExpanded(true);
      return;
    }
    const { tab, panel } = readOwnerSearch();
    setActiveTab(tab || 'pnl');
    if (panel) {
      setSettingsPanel(panel);
      setSettingsExpanded(true);
    }
  }, [pathname, searchParams]);

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
        onToggleSettings={() => {
          setSettingsExpanded((v) => !v);
          setActiveTab('settings');
        }}
        onGo={(tab, panel) => {
          if (tab === 'system-health') {
            window.location.href = '/owner/system-health';
            return;
          }
          const href = ownerHref(tab, panel);
          const onOwnerHome = pathname === '/owner' || pathname === '/owner/dashboard';
          if (onOwnerHome && !isRemoteOwnerTab(tab)) {
            if (pathname === '/owner/dashboard') {
              window.location.href = href.startsWith('/owner?') || href === '/owner' ? href : `/owner?tab=${tab}`;
              return;
            }
            window.history.pushState(null, '', href);
            setActiveTab(tab);
            if (panel) {
              setSettingsPanel(panel);
              setSettingsExpanded(true);
            }
            window.dispatchEvent(new CustomEvent(OWNER_TAB_EVENT, { detail: { tab, panel } }));
            return;
          }
          window.location.href = href;
        }}
        canSettings={canAccessSettings(role) || isOwnerRole(role)}
        isOwner={isOwnerRole(role)}
        onLogout={handleLogout}
      />
      {children}
      <OwnerBottomDock onMenu={() => setNavOpen(true)} />
    </>
  );
}
