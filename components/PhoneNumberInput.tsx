'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DIAL_COUNTRIES, composePhone, flagOf } from '@/lib/countryDialCodes';

type Props = {
  id?: string;
  /** Full number: 08… for Indonesia, +<code>… otherwise (see composePhone). */
  value: string;
  onChange: (full: string) => void;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
};

/** Initial country + national part from an existing value (+65… → Singapore). */
const splitValue = (value: string): { dial: string; national: string } => {
  const v = String(value || '').trim();
  if (!v.startsWith('+')) return { dial: '62', national: v };
  const digits = v.replace(/\D/g, '');
  const match = [...DIAL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => digits.startsWith(c.dial));
  return match ? { dial: match.dial, national: digits.slice(match.dial.length) } : { dial: '62', national: v };
};

/**
 * WhatsApp number with a country picker (all countries, Indonesia first).
 * Indonesia keeps the familiar 08… entry; other countries produce +<code>…
 * so lib/phone stores them unambiguously.
 */
export default function PhoneNumberInput({ id, value, onChange, className = '', required, autoFocus }: Props) {
  const initial = useMemo(() => splitValue(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [iso, setIso] = useState(() => DIAL_COUNTRIES.find((c) => c.dial === initial.dial)?.iso || 'ID');
  const [national, setNational] = useState(initial.national);
  const country = DIAL_COUNTRIES.find((c) => c.iso === iso) || DIAL_COUNTRIES[0];
  const indonesia = country.dial === '62';

  const update = (nextIso: string, nextNational: string) => {
    const c = DIAL_COUNTRIES.find((x) => x.iso === nextIso) || DIAL_COUNTRIES[0];
    setIso(c.iso);
    setNational(nextNational);
    onChange(composePhone(c.dial, nextNational));
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      {/* Closed state shows flag + code only; the native list shows full names. */}
      <div className="relative shrink-0 w-[96px] bg-slate-50 border border-slate-200 rounded-2xl px-3 py-3.5 text-sm font-bold text-slate-800 flex items-center justify-between gap-1 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
        <span aria-hidden="true" className="truncate">
          {flagOf(country.iso)} +{country.dial}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
        <select
          id={id ? `${id}-country` : undefined}
          aria-label="Kode negara"
          value={iso}
          onChange={(e) => update(e.target.value, national)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {DIAL_COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {flagOf(c.iso)} {c.name} (+{c.dial})
            </option>
          ))}
        </select>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        placeholder={indonesia ? 'Contoh: 081234567890' : `Nomor tanpa +${country.dial}`}
        value={national}
        onChange={(e) => update(iso, e.target.value)}
        className="min-w-0 flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-base font-bold text-slate-800 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:bg-white transition-all"
        required={required}
      />
    </div>
  );
}
