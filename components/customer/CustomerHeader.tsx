'use client';

import Image from 'next/image';

export default function CustomerHeader() {
  return (
    <header className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-200/80 flex items-center mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <Image
          src="/images/Logo-Laundrivery.png"
          alt="Laundrivery"
          width={160}
          height={40}
          priority
          className="h-10 w-auto max-h-10 object-contain object-left shrink-0"
        />
        <div className="min-w-0">
          <h1 className="text-base font-bold text-[#0084FF] tracking-tight leading-none">laundrivery</h1>
        </div>
      </div>
    </header>
  );
}
