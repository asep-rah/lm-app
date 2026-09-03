'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Gift } from 'lucide-react';
import BottomNavbar from '@/components/customer/BottomNavbar';
import CustomerHeader from '@/components/customer/CustomerHeader';
import { IconBadge } from '@/components/customer/ui';
import {
  DEFAULT_CRM_SETTINGS,
  cashbackCopy,
  ensureCrmProfile,
  idr,
  loadCrmSettings,
  nextTierInfo,
  ownerTierGuide,
  rateForTier,
  tierBadgeClass,
  type CrmProfile,
  type CrmSettings
} from '@/lib/crm';

export default function CustomerLoyaltyPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [profile, setProfile] = useState<CrmProfile | null>(null);
  const [settings, setSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = String(localStorage.getItem('laundry_customer_phone') || '').trim();
    if (!stored) {
      router.replace('/customer/dashboard');
      return;
    }
    setPhone(stored);
    Promise.all([ensureCrmProfile({ phone: stored }), loadCrmSettings()])
      .then(([p, s]) => {
        if (p) setProfile(p);
        setSettings(s);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [router]);

  const tier = profile?.tier_level || 'Standard';
  const spent = Number(profile?.total_spent) || 0;
  const points = Math.round(Number(profile?.loyalty_points) || 0);
  const next = nextTierInfo(spent, settings);
  const guide = ownerTierGuide(settings);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-6 pb-32 max-w-md mx-auto relative font-sans">
      <CustomerHeader />

      <button
        type="button"
        onClick={() => router.push('/customer/dashboard')}
        className="mb-3 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Beranda
      </button>

      <div className="relative overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-slate-900 via-slate-800 to-amber-900 p-5 text-white shadow-sm">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-200/80">Loyalty Points</p>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-white/70">Saldo poin</p>
            <p className="text-3xl font-black tabular-nums mt-0.5">{ready ? points.toLocaleString('id-ID') : '—'}</p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-black border ${tierBadgeClass(tier)}`}>
            {tier}
          </span>
        </div>
        <p className="mt-3 text-[11px] font-semibold text-amber-100/90 leading-relaxed">{cashbackCopy(tier, settings)}</p>
        <p className="mt-2 text-[10px] text-white/50">Total belanja {idr(spent)}</p>
      </div>

      {next.next ? (
        <div className="mt-4 bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Menuju {next.next}</p>
          <p className="text-xs font-bold text-slate-800 mt-1">
            Belanja {idr(next.remaining)} lagi untuk naik ke {next.next} ({rateForTier(next.next, settings)}% poin).
          </p>
          <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.round(next.progress * 100)}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Ambang {next.next}: {idr(next.threshold)} · progres {Math.round(next.progress * 100)}%
          </p>
        </div>
      ) : (
        <div className="mt-4 bg-white border border-amber-200 rounded-3xl p-4 shadow-sm">
          <p className="text-xs font-extrabold text-amber-800">Anda di level tertinggi Platinum.</p>
          <p className="text-[11px] text-slate-500 mt-1">Nikmati cashback {settings.platinum_rate}% poin setiap cucian selesai.</p>
        </div>
      )}

      <div className="mt-4 bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <IconBadge icon={Gift} tone="amber" size="sm" />
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Skema tier Owner</h2>
            <p className="text-[10px] text-slate-400">Persentase dan ambang belanja mengikuti pengaturan CRM.</p>
          </div>
        </div>
        <div className="space-y-2">
          {guide.map((row) => {
            const on = row.tier === tier;
            return (
              <div
                key={row.tier}
                className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 ${
                  on ? 'border-amber-300 bg-amber-50' : 'border-slate-100 bg-slate-50'
                }`}
              >
                <div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black border ${tierBadgeClass(row.tier)}`}>
                    {row.tier}
                  </span>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {row.threshold > 0 ? `Mulai ${idr(row.threshold)} total belanja` : 'Tier awal'}
                  </p>
                </div>
                <p className="text-sm font-black text-slate-900 tabular-nums">{row.rate}%</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-2 text-xs">
        <h2 className="text-sm font-extrabold text-slate-900">Cara poin dihitung</h2>
        <p className="text-slate-600 leading-relaxed">
          Poin masuk otomatis saat cucian berstatus <b>Selesai</b>. Rumusnya:{' '}
          <b>nominal transaksi × {rateForTier(tier, settings)}%</b> sesuai tier Anda saat ini.
        </p>
        <p className="text-slate-600 leading-relaxed">
          Jika tidak order selama <b>{settings.inactive_days} hari</b>, kami kirim pengingat retensi.
        </p>
        {settings.retention_message ? (
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-2xl p-3 leading-relaxed">
            {settings.retention_message}
          </p>
        ) : null}
      </div>

      <BottomNavbar
        activeTab="home"
        customerPhone={phone}
        onHome={() => router.push('/customer/dashboard')}
        onChat={() => router.push('/customer/dashboard?open=chat')}
        onOrder={() => router.push('/order')}
        onActivity={() => router.push('/aktivitas')}
        onProfile={() => router.push('/profil')}
      />
    </div>
  );
}
