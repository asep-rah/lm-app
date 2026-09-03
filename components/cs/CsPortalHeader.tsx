'use client';

import Link from 'next/link';
import CsWorkspaceNav from '@/components/cs/CsWorkspaceNav';
import { useCsPortal } from '@/components/cs/CsPortalProvider';
import { roleLabelOf } from '@/lib/staffRoles';

export default function CsPortalHeader() {
  const { agent, unlockAudio } = useCsPortal();

  const handleLogout = () => {
    localStorage.removeItem('laundry_user');
    localStorage.removeItem('laundry_owner_user');
    window.location.href = '/login';
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur print:hidden" onPointerDown={unlockAudio}>
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/cs/workspace" className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-600">CS Workspace</p>
          <p className="text-sm font-black text-slate-900 truncate">{agent.name || 'Customer Service'}</p>
          <p className="text-[11px] text-slate-500">{roleLabelOf(agent.role || 'cs')}</p>
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="shrink-0 text-[11px] font-bold px-3.5 py-2 rounded-xl text-rose-600 border border-rose-100 hover:bg-rose-50"
        >
          Keluar
        </button>
      </div>
      <CsWorkspaceNav />
    </header>
  );
}
