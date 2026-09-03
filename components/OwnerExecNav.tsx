'use client';

import Link from 'next/link';

const ITEMS = [
  { href: '/owner', id: 'main', label: 'Dashboard Utama', icon: '📊' },
  { href: '/owner/kpi', id: 'kpi', label: 'Tabel KPI 7 Role', icon: '📋' },
  { href: '/owner/delegasi', id: 'delegasi', label: 'Delegasi & SLA Control', icon: '📑' },
  { href: '/owner/crm', id: 'crm', label: 'CRM Loyalty', icon: '💎' }
] as const;

export default function OwnerExecNav({ active }: { active: 'main' | 'kpi' | 'delegasi' | 'crm' }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
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
            {item.icon} {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
