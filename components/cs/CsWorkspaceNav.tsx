'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Headphones, MessageSquare, Truck } from 'lucide-react';
import { useCsPortal } from '@/components/cs/CsPortalProvider';

const ITEMS = [
  { id: 'chat', href: '/cs', label: 'Live Chat', icon: MessageSquare, badge: 'unreadChats' as const },
  { id: 'pickup', href: '/cs/dashboard', label: 'Antrian Pickup', icon: Truck, badge: 'pendingPickups' as const },
  { id: 'care', href: '/cs/care', label: 'CS Care', icon: Headphones, badge: 'urgentComplaints' as const }
] as const;

const currentIdOf = (path: string) => {
  if (path.startsWith('/cs/care')) return 'care';
  if (path.startsWith('/cs/dashboard')) return 'pickup';
  if (path === '/cs' || path.startsWith('/cs?')) return 'chat';
  return null;
};

export default function CsWorkspaceNav() {
  const pathname = usePathname() || '';
  const current = currentIdOf(pathname);
  const { unreadChats, pendingPickups, urgentComplaints } = useCsPortal();
  if (!current) return null;

  const counts = { unreadChats, pendingPickups, urgentComplaints };
  const items = ITEMS.filter((item) => item.id !== current);

  return (
    <nav className="max-w-5xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        const count = counts[item.badge];
        return (
          <Link
            key={item.id}
            href={item.href}
            className="relative flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-slate-50 border border-slate-200 text-slate-700 hover:bg-white hover:border-sky-300 hover:text-sky-700 transition"
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2.3} />
            {item.label}
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
