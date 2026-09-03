'use client';

import { ClipboardList, Home, MessageSquare, User, Wrench } from 'lucide-react';

export type PosTab = 'home' | 'proses' | 'chat' | 'pengajuan' | 'profil';

export default function PosBottomNavbar({
  activeTab,
  onChange,
  prosesCount,
  incomingCount
}: {
  activeTab: PosTab;
  onChange: (tab: PosTab) => void;
  prosesCount?: number;
  incomingCount?: number;
}) {
  const item = (on: boolean) => (on ? 'text-emerald-600' : 'text-slate-400');
  const tabClass = 'relative flex flex-col items-center justify-center gap-0.5 py-1 min-h-[2.75rem]';
  const badge = prosesCount || incomingCount || 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 print:hidden">
      <div className="bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] px-1 pt-1.5 pb-[max(0.55rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-5 items-center max-w-7xl mx-auto">
          <button type="button" onClick={() => onChange('home')} className={`${tabClass} ${item(activeTab === 'home')}`}>
            <Home className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-[9px] font-extrabold">Beranda</span>
          </button>
          <button type="button" onClick={() => onChange('proses')} className={`${tabClass} ${item(activeTab === 'proses')}`}>
            <Wrench className="w-5 h-5" strokeWidth={2.2} />
            {!!badge && (
              <span className="absolute top-0 right-[18%] min-w-[15px] h-[15px] px-1 rounded-full bg-amber-500 text-white text-[8px] font-black flex items-center justify-center">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
            <span className="text-[9px] font-extrabold">Proses</span>
          </button>
          <button type="button" onClick={() => onChange('chat')} className={`${tabClass} ${item(activeTab === 'chat')}`}>
            <MessageSquare className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-[9px] font-extrabold">Chat</span>
          </button>
          <button type="button" onClick={() => onChange('pengajuan')} className={`${tabClass} ${item(activeTab === 'pengajuan')}`}>
            <ClipboardList className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-[9px] font-extrabold">Pengajuan</span>
          </button>
          <button type="button" onClick={() => onChange('profil')} className={`${tabClass} ${item(activeTab === 'profil')}`}>
            <User className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-[9px] font-extrabold">Profil</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
