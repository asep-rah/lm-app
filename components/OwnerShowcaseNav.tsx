'use client';

import Link from 'next/link';

const ITEMS = [
  { href: '/owner/settings/outlets', id: 'outlets', label: 'Profil Outlet' },
  { href: '/owner/settings/promos', id: 'promos', label: 'Banner Promo' }
] as const;

export default function OwnerShowcaseNav({ active }: { active: 'outlets' | 'promos' }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      <Link
        href="/owner?tab=settings"
        className="whitespace-nowrap px-3.5 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
      >
        ← Settings
      </Link>
      {ITEMS.map((item) => {
        const on = active === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`whitespace-nowrap px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              on
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
