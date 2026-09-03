'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gift } from 'lucide-react';
import { IconBadge } from '@/components/customer/ui';
import {
  cashbackCopy,
  ensureCrmProfile,
  loadCrmSettings,
  tierBadgeClass,
  type CrmProfile,
  type CrmSettings,
  DEFAULT_CRM_SETTINGS
} from '@/lib/crm';

export default function LoyaltyProfileCard({
  phone,
  name,
  outletId
}: {
  phone: string;
  name?: string;
  outletId?: string;
}) {
  const [profile, setProfile] = useState<CrmProfile | null>(null);
  const [settings, setSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);

  useEffect(() => {
    if (!phone) return;
    let cancelled = false;
    Promise.all([ensureCrmProfile({ phone, name, outletId }), loadCrmSettings()])
      .then(([p, s]) => {
        if (cancelled) return;
        if (p) setProfile(p);
        setSettings(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phone, name, outletId]);

  const tier = profile?.tier_level || 'Standard';
  const points = Math.round(Number(profile?.loyalty_points) || 0);

  return (
    <Link
      href="/customer/loyalty"
      className="bg-white border border-slate-200 p-3 rounded-3xl flex flex-col gap-2 shadow-sm text-left min-w-0 hover:border-amber-400 hover:shadow-md active:scale-[0.99] transition"
    >
      <IconBadge icon={Gift} tone="amber" size="lg" />
      <div className="min-w-0">
        <span className="text-[10px] font-extrabold text-slate-900 block">Loyalty</span>
        <span className={`mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-black border ${tierBadgeClass(tier)}`}>
          {tier}
        </span>
        <span className="text-[10px] text-amber-700 font-bold mt-1 block tabular-nums">{points.toLocaleString('id-ID')} poin</span>
        <span className="text-[8px] text-slate-400 font-medium mt-0.5 block leading-tight line-clamp-2">
          {cashbackCopy(tier, settings)}
        </span>
      </div>
    </Link>
  );
}
