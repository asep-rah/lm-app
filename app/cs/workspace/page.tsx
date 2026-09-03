'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Headphones, MessageSquare, Truck } from 'lucide-react';
import { getStaffSession, homePathForRole, isCsRole } from '@/lib/staffSession';
import { useCsPortal } from '@/components/cs/CsPortalProvider';

export default function CsWorkspacePage() {
  const { unreadChats, pendingPickups, urgentComplaints, unlockAudio } = useCsPortal();

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const role = getStaffSession().role;
    if (!isCsRole(role) && role !== 'owner' && role !== 'supervisor') {
      window.location.href = homePathForRole(role);
    }
  }, []);

  const cards = [
    {
      href: '/cs',
      icon: MessageSquare,
      tone: 'sky',
      title: 'Live Chat',
      desc: 'Dukungan pelanggan & inquiry. Klaim thread sebelum membalas.',
      badge: unreadChats,
      badgeLabel: unreadChats === 1 ? '1 Unread' : `${unreadChats} Unread`,
      cta: 'Buka live chat'
    },
    {
      href: '/cs/dashboard',
      icon: Truck,
      tone: 'indigo',
      title: 'Antrean Pickup & Dispatch Driver',
      desc: 'Order jemput online. Hanya driver ON DUTY yang bisa di-assign; jika kosong, pesan kurir instan Gojek / Grab / Lalamove.',
      badge: pendingPickups,
      badgeLabel: pendingPickups === 1 ? '1 Pending' : `${pendingPickups} Pending`,
      cta: 'Buka antrean pickup'
    },
    {
      href: '/cs/care',
      icon: Headphones,
      tone: 'rose',
      title: 'CS Care (Handling Komplain)',
      desc: 'Tiket hilang, rusak, telat, dan unboxing. Investigasi sampai selesai.',
      badge: urgentComplaints,
      badgeLabel: urgentComplaints === 1 ? '1 Urgent' : `${urgentComplaints} Urgent`,
      cta: 'Buka CS Care'
    }
  ] as const;

  const toneBox: Record<string, string> = {
    sky: 'bg-sky-50 text-sky-600 border-sky-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100'
  };
  const toneBtn: Record<string, string> = {
    sky: 'bg-sky-600 hover:bg-sky-700',
    indigo: 'bg-indigo-600 hover:bg-indigo-700',
    rose: 'bg-rose-600 hover:bg-rose-700'
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-10" onPointerDown={unlockAudio}>
      <div className="mb-6">
        <h1 className="text-xl font-black text-slate-900">Pilih fokus kerja</h1>
        <p className="text-xs text-slate-500 mt-1">Tiga pintu CS. Badge merah tetap menyala sampai thread diklaim atau tiket ditutup.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="relative bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition flex flex-col min-h-[220px]"
            >
              {card.badge > 0 && (
                <span className="absolute top-4 right-4 min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                  {card.badge > 99 ? '99+' : card.badge}
                </span>
              )}
              <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center ${toneBox[card.tone]}`}>
                <Icon className="w-5 h-5" strokeWidth={2.2} />
              </div>
              <h2 className="text-sm font-black text-slate-900 mt-4">{card.title}</h2>
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed flex-1">{card.desc}</p>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-black uppercase tracking-wide ${
                    card.badge > 0 ? 'text-rose-600' : 'text-slate-400'
                  }`}
                >
                  {card.badge > 0 ? card.badgeLabel : 'Kosong'}
                </span>
                <span className={`text-[10px] font-bold text-white px-2.5 py-1 rounded-lg ${toneBtn[card.tone]}`}>
                  {card.cta}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
