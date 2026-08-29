'use client';

import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  Clock,
  Droplets,
  Flame,
  Minus,
  Plus,
  Scissors,
  ShoppingBag,
  Store,
  Truck,
  Wind,
  Zap,
  Star
} from 'lucide-react';

const TONE: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
  cyan: 'bg-cyan-50 text-cyan-600',
  white: 'bg-white/20 text-white backdrop-blur-md border border-white/25'
};

const PAD: Record<string, string> = { sm: 'p-1.5', md: 'p-2', lg: 'p-2.5' };
const ICON: Record<string, string> = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-5 h-5' };

export function IconBadge({
  icon: Glyph,
  tone = 'blue',
  size = 'md',
  pulse = false,
  className = ''
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONE;
  size?: keyof typeof PAD;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full ${TONE[tone] || TONE.blue} ${PAD[size]} ${
        pulse ? 'animate-pulse' : ''
      } ${className}`}
    >
      <Glyph className={ICON[size]} strokeWidth={2.2} />
    </span>
  );
}

export function StatusPill({ status }: { status?: string }) {
  const s = String(status || '').toLowerCase();
  let Glyph: LucideIcon = Clock;
  let tone = 'amber';
  if (s.includes('selesai') || s.includes('delivered') || s.includes('terkirim')) {
    Glyph = CheckCircle2;
    tone = 'emerald';
  } else if (s.includes('antar') || s.includes('menuju') || s.includes('jemput') || s.includes('driver')) {
    Glyph = Truck;
    tone = 'blue';
  } else if (s.includes('outlet') || s.includes('diterima') || s.includes('kasir')) {
    Glyph = Store;
    tone = 'indigo';
  } else if (s.includes('siap')) {
    Glyph = Box;
    tone = 'cyan';
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md border shadow-sm ${
        tone === 'emerald'
          ? 'bg-emerald-50/80 text-emerald-700 border-emerald-100/80'
          : tone === 'blue'
          ? 'bg-blue-50/80 text-blue-700 border-blue-100/80'
          : tone === 'indigo'
          ? 'bg-indigo-50/80 text-indigo-700 border-indigo-100/80'
          : tone === 'cyan'
          ? 'bg-cyan-50/80 text-cyan-700 border-cyan-100/80'
          : 'bg-amber-50/80 text-amber-700 border-amber-100/80'
      }`}
    >
      <Glyph className={`w-3 h-3 ${tone === 'amber' || tone === 'blue' ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`} strokeWidth={2.4} />
      {/pack/i.test(s) ? 'Dikemas' : (status || 'Menunggu')}
    </span>
  );
}

export function SlaBadge({ duration, createdAt }: { duration?: string; createdAt?: string }) {
  const d = String(duration || '');
  const express = /express|quick|oneday/i.test(d);
  let slaHours = 72;
  if (/quick|3 jam/i.test(d)) slaHours = 3;
  else if (/express|6 jam/i.test(d)) slaHours = 6;
  else if (/oneday|1 hari/i.test(d)) slaHours = 24;
  const created = createdAt ? new Date(createdAt).getTime() : 0;
  const overdue = Boolean(created && Date.now() - created > slaHours * 3_600_000);

  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-full">
        <AlertCircle className="w-3 h-3 animate-pulse" /> Overdue
      </span>
    );
  }
  if (express) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">
        <Zap className="w-3 h-3" /> Express
      </span>
    );
  }
  return null;
}

export function StepperBtn({
  onClick,
  disabled,
  variant,
  tone = 'blue'
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: 'plus' | 'minus';
  tone?: 'blue' | 'indigo';
}) {
  const Icon = variant === 'plus' ? Plus : Minus;
  const plusTone = tone === 'indigo' ? 'bg-indigo-600 shadow-indigo-200' : 'bg-blue-600 shadow-blue-200';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={variant === 'plus' ? 'Tambah' : 'Kurang'}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90 disabled:opacity-40 ${
        variant === 'plus' ? `${plusTone} text-white shadow-sm` : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={2.5} />
    </button>
  );
}

export const TRACKER_STAGES: { label: string; icon: LucideIcon; match: string[] }[] = [
  { label: 'Jemput', icon: Truck, match: ['baru', 'menunggu', 'request', 'jemput', 'menuju', 'dibawa'] },
  { label: 'Diterima', icon: Store, match: ['diterima', 'tiba', 'kasir'] },
  { label: 'Proses', icon: Droplets, match: ['cuci', 'mencuci', 'sortir', 'ering'] },
  { label: 'Setrika', icon: Flame, match: ['setrika', 'gosok', 'pack', 'emas'] },
  { label: 'Siap', icon: Box, match: ['siap'] },
  { label: 'Selesai', icon: CheckCircle2, match: ['selesai', 'terkirim', 'delivered', 'diambil'] }
];

export const TIMELINE_ICONS: Record<string, LucideIcon> = {
  jemput: Truck,
  outlet: Store,
  sortir: Scissors,
  cuci: Droplets,
  kering: Wind,
  setrika: Flame,
  packing: ShoppingBag,
  siap: Box,
  selesai: CheckCircle2
};

export function StarRating({
  value,
  onChange,
  size = 22
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: number;
}) {
  return (
    <div className="flex justify-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className="transition-transform duration-150 active:scale-90"
          aria-label={`${n} bintang`}
        >
          <Star
            className={`transition-colors duration-200 ${value >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
            style={{ width: size, height: size }}
            strokeWidth={1.6}
          />
        </button>
      ))}
    </div>
  );
}

export { AlertTriangle, Package, Sparkles } from 'lucide-react';
