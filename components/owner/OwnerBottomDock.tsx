'use client';

import Link from 'next/link';
import { Menu, MessageSquare, Shield } from 'lucide-react';
import { openOutletGroupChat } from '@/lib/outletGroupChat';
import { useOwnerSystemHealthNotifs } from '@/components/owner/useOwnerSystemHealthNotifs';

/**
 * Bottom bar owner ala Smartlink:
 * [ Chat Grup ]  [ ● Menu ]  [ Diagnosa ]
 * Menu (tengah) membuka sidebar; chat tidak pakai FAB mengambang di /owner.
 */
export default function OwnerBottomDock({ onMenu }: { onMenu: () => void }) {
  const { unread: healthUnread } = useOwnerSystemHealthNotifs();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-slate-200/90 bg-white/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(15,23,42,0.06)]"
      style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))' }}
      aria-label="Navigasi owner"
    >
      <div className="mx-auto max-w-lg grid grid-cols-3 items-end gap-0 px-2 pt-1.5 pb-1">
        {/* Kiri: Chat grup outlet */}
        <button
          type="button"
          onClick={() => openOutletGroupChat()}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[3.25rem] text-slate-600 hover:text-sky-600 transition active:scale-[0.98]"
          title="Chat Grup Outlet"
        >
          <span className="w-10 h-10 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-sky-600" strokeWidth={2.2} />
          </span>
          <span className="text-[10px] font-extrabold leading-tight text-slate-700">Chat Grup</span>
        </button>

        {/* Tengah: Menu (elevated) */}
        <div className="flex flex-col items-center justify-end -mt-7 pb-0.5">
          <button
            type="button"
            onClick={onMenu}
            className="w-[3.75rem] h-[3.75rem] rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/35 flex items-center justify-center ring-[6px] ring-white hover:bg-blue-700 active:scale-95 transition"
            aria-label="Buka menu"
          >
            <Menu className="w-7 h-7" strokeWidth={2.5} />
          </button>
          <span className="text-[10px] font-black text-blue-700 mt-1 tracking-wide">Menu</span>
        </div>

        {/* Kanan: Diagnosa sistem */}
        <Link
          href="/owner/system-health"
          className="relative flex flex-col items-center justify-center gap-0.5 min-h-[3.25rem] text-slate-600 hover:text-indigo-700 transition active:scale-[0.98]"
          title="Diagnosis Sistem"
        >
          <span className="relative w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Shield className="w-5 h-5 text-indigo-600" strokeWidth={2.2} />
            {healthUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center animate-pulse">
                {healthUnread > 99 ? '99+' : healthUnread}
              </span>
            )}
          </span>
          <span className="text-[10px] font-extrabold leading-tight text-slate-700">Diagnosa</span>
        </Link>
      </div>
    </nav>
  );
}
