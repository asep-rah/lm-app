'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';

/** Logo + judul header owner (Analytics / ERP). */
export default function OwnerHeaderBrand({
  eyebrow = 'Owner Analytics',
  title = 'Laundrivery ERP',
  subtitle
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="relative w-11 h-11 shrink-0 rounded-full bg-sky-50 border border-sky-100 overflow-hidden shadow-sm">
        <Image
          src="/images/Logo-Laundrivery.png"
          alt="Laundrivery"
          fill
          sizes="44px"
          className="object-contain p-1"
          priority
        />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">{eyebrow}</p>
        <h1 className="text-lg md:text-2xl font-black tracking-tight text-slate-900 truncate">{title}</h1>
        {subtitle ? <p className="text-xs text-slate-400 truncate">{subtitle}</p> : null}
      </div>
    </div>
  );
}
