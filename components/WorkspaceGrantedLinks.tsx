'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadMyPermissions } from '@/lib/staffPermissionsClient';

/** Halaman area owner yang dibuka lewat hak akses (diatur owner). */
const PAGES: { permission: string; href: string; label: string }[] = [
  { permission: 'view.owner_dashboard', href: '/owner', label: 'Dashboard owner' },
  { permission: 'view.finance_reports', href: '/owner/reports/laba-rugi', label: 'Laporan keuangan' },
  { permission: 'view.crm', href: '/owner/crm', label: 'CRM pelanggan' },
  { permission: 'view.performance', href: '/owner/performance', label: 'Performa & KPI' },
  { permission: 'view.machines', href: '/owner/machines', label: 'Mesin' },
  { permission: 'view.delegation', href: '/owner/delegasi', label: 'Delegasi tugas' },
  { permission: 'view.vouchers', href: '/owner/vouchers', label: 'Voucher & promo' }
];

export default function WorkspaceGrantedLinks() {
  const [links, setLinks] = useState<typeof PAGES>([]);

  useEffect(() => {
    let cancelled = false;
    void loadMyPermissions().then((perms) => {
      if (!cancelled) setLinks(PAGES.filter((p) => perms.has(p.permission)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!links.length) return null;
  return (
    <section className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h2 className="text-sm font-semibold">Akses tambahan</h2>
      <p className="text-[11px] text-slate-400 mb-2">Halaman yang dibuka owner untuk peran Anda.</p>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
