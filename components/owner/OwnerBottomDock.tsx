'use client';

import Link from 'next/link';
import { Menu, MessageSquare, Shield } from 'lucide-react';
import { openOutletGroupChat } from '@/lib/outletGroupChat';
import { useOwnerSystemHealthNotifs } from '@/components/owner/useOwnerSystemHealthNotifs';

/** Bottom bar owner: Chat · Menu (tengah) · Diagnosis — fixed, bukan FAB mengambang. */
export default function OwnerBottomDock({ onMenu }: { onMenu: () => void }) {
  const { unread: healthUnread } = useOwnerSystemHealthNotifs();

  const sideBtn =
    'flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[3rem] text-slate-600 hover:text-sky-700 transition';

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-sky-100/80 bg-sky-50/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Navigasi owner"
    >
      <div className="mx-auto max-w-lg flex items-end px-1 pt-1 pb-1.5">
        <button type="button" onClick={() => openOutletGroupChat()} className={sideBtn} title="Grup Outlet">
          <MessageSquare className="w-5 h-5" strokeWidth={2.2} />
          <span className="text-[10px] font-extrabold leading-tight">Chat Outlet</span>
        </button>

        <div className="relative flex flex-col items-center justify-end px-2 -mt-5">
          <button
            type="button"
            onClick={onMenu}
            className="w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center ring-4 ring-sky-50 hover:bg-blue-700 active:scale-95 transition"
            aria-label="Buka menu"
          >
            <Menu className="w-6 h-6" strokeWidth={2.4} />
          </button>
          <span className="text-[10px] font-extrabold text-blue-700 mt-0.5">Menu</span>
        </div>

        <Link href="/owner/system-health" className={`relative ${sideBtn}`} title="Diagnosis Sistem">
          <Shield className="w-5 h-5" strokeWidth={2.2} />
          <span className="text-[10px] font-extrabold leading-tight">Diagnosa</span>
          {healthUnread > 0 && (
            <span className="absolute top-0.5 right-[18%] min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center animate-pulse">
              {healthUnread > 99 ? '99+' : healthUnread}
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}
