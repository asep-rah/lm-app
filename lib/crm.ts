import { canonicalPhone, phoneVariants } from '@/lib/csChat';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { supabase } from '@/lib/supabaseClient';

export const CRM_TIERS = ['Standard', 'Silver', 'Gold', 'Platinum'] as const;
export type CrmTier = (typeof CRM_TIERS)[number];

export const PERFUME_OPTIONS = ['Standard', 'Lavender', 'Lily', 'Tanpa Parfum'] as const;
export const FOLD_OPTIONS = ['Lipat Rapi', 'Gantung', 'Hanger'] as const;

export type CrmSettings = {
  id: number;
  standard_rate: number;
  silver_rate: number;
  gold_rate: number;
  platinum_rate: number;
  silver_threshold: number;
  gold_threshold: number;
  platinum_threshold: number;
  inactive_days: number;
  retention_message: string;
};

export type CrmProfile = {
  phone: string;
  name: string;
  tier_level: CrmTier;
  loyalty_points: number;
  total_spent: number;
  last_order_at: string | null;
  last_retention_at: string | null;
  perfume_pref: string;
  fold_pref: string;
  special_notes: string;
  outlet_id: string | null;
};

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  id: 1,
  standard_rate: 1,
  silver_rate: 2,
  gold_rate: 3,
  platinum_rate: 5,
  silver_threshold: 500000,
  gold_threshold: 1500000,
  platinum_threshold: 3000000,
  inactive_days: 21,
  retention_message:
    'Sudah lama tidak cuci di Laundrivery. Yuk order lagi dan kumpulkan poin loyalty sesuai tier Anda.'
};

export const crmPhoneKey = (raw?: string | null) => {
  const canon = canonicalPhone(String(raw || ''));
  return canon || String(raw || '').replace(/\D/g, '');
};

export const normalizeTier = (raw?: string | null): CrmTier => {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'silver') return 'Silver';
  if (s === 'gold') return 'Gold';
  if (s === 'platinum') return 'Platinum';
  return 'Standard';
};

export const rateForTier = (tier: string | null | undefined, settings: CrmSettings) => {
  const t = normalizeTier(tier);
  if (t === 'Platinum') return Number(settings.platinum_rate) || 0;
  if (t === 'Gold') return Number(settings.gold_rate) || 0;
  if (t === 'Silver') return Number(settings.silver_rate) || 0;
  return Number(settings.standard_rate) || 0;
};

export const evaluateTier = (totalSpent: number, settings: CrmSettings): CrmTier => {
  const spent = Number(totalSpent) || 0;
  if (spent >= (Number(settings.platinum_threshold) || 0)) return 'Platinum';
  if (spent >= (Number(settings.gold_threshold) || 0)) return 'Gold';
  if (spent >= (Number(settings.silver_threshold) || 0)) return 'Silver';
  return 'Standard';
};

export const formatWashPrefsNote = (profile?: Partial<CrmProfile> | null) => {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.perfume_pref) parts.push(`Aroma: ${profile.perfume_pref}`);
  if (profile.fold_pref) parts.push(`Lipat: ${profile.fold_pref}`);
  if (profile.special_notes) parts.push(`Catatan: ${profile.special_notes}`);
  return parts.length ? `Preferensi Cucian: ${parts.join(' | ')}` : '';
};

export const withWashPrefNotes = (baseNotes: string, profile?: Partial<CrmProfile> | null) => {
  const pref = formatWashPrefsNote(profile);
  if (!pref) return baseNotes || '';
  if (String(baseNotes || '').includes('Preferensi Cucian:')) return baseNotes;
  return baseNotes ? `${pref} | ${baseNotes}` : pref;
};

export const tierBadgeClass = (tier: string) => {
  const t = normalizeTier(tier);
  if (t === 'Platinum') return 'bg-slate-900 text-amber-200 border-slate-800';
  if (t === 'Gold') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (t === 'Silver') return 'bg-slate-200 text-slate-700 border-slate-300';
  return 'bg-sky-50 text-sky-700 border-sky-200';
};

export const cashbackCopy = (tier: string, settings: CrmSettings) => {
  const t = normalizeTier(tier);
  const pct = rateForTier(t, settings);
  return `Level ${t}: Nikmati cashback ${pct}% Poin setiap cuci`;
};

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const mapCrmSettings = (row?: Record<string, unknown> | null): CrmSettings => ({
  id: 1,
  standard_rate: num(row?.standard_rate, DEFAULT_CRM_SETTINGS.standard_rate),
  silver_rate: num(row?.silver_rate, DEFAULT_CRM_SETTINGS.silver_rate),
  gold_rate: num(row?.gold_rate, DEFAULT_CRM_SETTINGS.gold_rate),
  platinum_rate: num(row?.platinum_rate, DEFAULT_CRM_SETTINGS.platinum_rate),
  silver_threshold: num(row?.silver_threshold, DEFAULT_CRM_SETTINGS.silver_threshold),
  gold_threshold: num(row?.gold_threshold, DEFAULT_CRM_SETTINGS.gold_threshold),
  platinum_threshold: num(row?.platinum_threshold, DEFAULT_CRM_SETTINGS.platinum_threshold),
  inactive_days: Math.max(1, Math.round(num(row?.inactive_days, DEFAULT_CRM_SETTINGS.inactive_days))),
  retention_message: String(row?.retention_message || DEFAULT_CRM_SETTINGS.retention_message)
});

export const mapCrmProfile = (row?: Record<string, unknown> | null, fallbackPhone = ''): CrmProfile => ({
  phone: String(row?.phone || fallbackPhone),
  name: String(row?.name || ''),
  tier_level: normalizeTier(String(row?.tier_level || 'Standard')),
  loyalty_points: num(row?.loyalty_points),
  total_spent: num(row?.total_spent),
  last_order_at: row?.last_order_at ? String(row.last_order_at) : null,
  last_retention_at: row?.last_retention_at ? String(row.last_retention_at) : null,
  perfume_pref: String(row?.perfume_pref || ''),
  fold_pref: String(row?.fold_pref || ''),
  special_notes: String(row?.special_notes || ''),
  outlet_id: row?.outlet_id ? String(row.outlet_id) : null
});

export async function loadCrmSettings(): Promise<CrmSettings> {
  const { data, error } = await supabase.from('crm_settings').select('*').eq('id', 1).limit(1);
  if (error || !data?.length) return DEFAULT_CRM_SETTINGS;
  return mapCrmSettings(data[0]);
}

export async function saveCrmSettings(next: CrmSettings): Promise<{ error: { message: string } | null }> {
  const payload = {
    id: 1,
    standard_rate: num(next.standard_rate, 1),
    silver_rate: num(next.silver_rate, 2),
    gold_rate: num(next.gold_rate, 3),
    platinum_rate: num(next.platinum_rate, 5),
    silver_threshold: num(next.silver_threshold, 500000),
    gold_threshold: num(next.gold_threshold, 1500000),
    platinum_threshold: num(next.platinum_threshold, 3000000),
    inactive_days: Math.max(1, Math.round(num(next.inactive_days, 21))),
    retention_message: String(next.retention_message || DEFAULT_CRM_SETTINGS.retention_message)
  };
  const { data } = await supabase.from('crm_settings').select('id').eq('id', 1).limit(1);
  if (data?.length) {
    return updateWithFallback('crm_settings', [payload, { ...payload, retention_message: undefined }], {
      column: 'id',
      value: 1
    });
  }
  return insertWithFallback('crm_settings', [payload, { ...payload, retention_message: undefined }]);
}

export async function loadCrmProfile(phone?: string | null): Promise<CrmProfile | null> {
  const variants = phoneVariants(phone || '');
  if (!variants.length) return null;
  const { data, error } = await supabase.from('customer_crm_profiles').select('*').in('phone', variants).limit(1);
  if (error || !data?.length) return null;
  return mapCrmProfile(data[0]);
}

export async function ensureCrmProfile(opts: {
  phone: string;
  name?: string | null;
  outletId?: string | null;
}): Promise<CrmProfile | null> {
  const phone = crmPhoneKey(opts.phone);
  if (!phone) return null;
  const existing = await loadCrmProfile(phone);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (opts.name && opts.name !== existing.name) patch.name = opts.name;
    if (opts.outletId && opts.outletId !== existing.outlet_id) patch.outlet_id = opts.outletId;
    if (Object.keys(patch).length) {
      await updateWithFallback('customer_crm_profiles', [patch], { column: 'phone', value: existing.phone });
      return { ...existing, ...mapCrmProfile({ ...existing, ...patch }, existing.phone) };
    }
    return existing;
  }
  const row = {
    phone,
    name: opts.name || '',
    tier_level: 'Standard',
    loyalty_points: 0,
    total_spent: 0,
    perfume_pref: 'Standard',
    fold_pref: 'Lipat Rapi',
    special_notes: '',
    outlet_id: opts.outletId || null
  };
  const { data, error } = await insertWithFallback<Record<string, unknown>>('customer_crm_profiles', [
    row,
    { phone, name: row.name, tier_level: 'Standard', loyalty_points: 0, total_spent: 0 },
    { phone, tier_level: 'Standard' }
  ]);
  if (error || !data?.length) return mapCrmProfile(row, phone);
  return mapCrmProfile(data[0], phone);
}

export async function saveCrmPreferences(opts: {
  phone: string;
  name?: string | null;
  outletId?: string | null;
  perfume_pref: string;
  fold_pref: string;
  special_notes: string;
}): Promise<{ error: { message: string } | null; profile: CrmProfile | null }> {
  const phone = crmPhoneKey(opts.phone);
  if (!phone) return { error: { message: 'Nomor WA tidak valid' }, profile: null };
  const existing = await ensureCrmProfile({ phone, name: opts.name, outletId: opts.outletId });
  const key = existing?.phone || phone;
  const patch = {
    name: opts.name || existing?.name || '',
    perfume_pref: opts.perfume_pref,
    fold_pref: opts.fold_pref,
    special_notes: opts.special_notes,
    outlet_id: opts.outletId || existing?.outlet_id || null
  };
  const { error } = await updateWithFallback(
    'customer_crm_profiles',
    [patch, { perfume_pref: patch.perfume_pref, fold_pref: patch.fold_pref, special_notes: patch.special_notes }],
    { column: 'phone', value: key }
  );
  return { error, profile: existing ? { ...existing, ...patch, phone: key } : mapCrmProfile({ ...patch, phone: key }, key) };
}

export type CrmSegment = 'active' | 'at_risk' | 'vip';

export const profileSegment = (profile: CrmProfile, settings: CrmSettings, now = Date.now()): CrmSegment | 'idle' => {
  if (normalizeTier(profile.tier_level) === 'Platinum') return 'vip';
  const last = profile.last_order_at ? new Date(profile.last_order_at).getTime() : 0;
  const days = settings.inactive_days || 21;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  if (last && last >= cutoff) return 'active';
  if (!last || last < cutoff) return 'at_risk';
  return 'idle';
};

export const isVipChampion = (profile: CrmProfile) => {
  const t = normalizeTier(profile.tier_level);
  return t === 'Platinum' || t === 'Gold';
};

export const isAtRisk = (profile: CrmProfile, settings: CrmSettings, now = Date.now()) => {
  const last = profile.last_order_at ? new Date(profile.last_order_at).getTime() : 0;
  if (!last) return false;
  const cutoff = now - (settings.inactive_days || 21) * 24 * 60 * 60 * 1000;
  return last < cutoff;
};

export const isActiveCustomer = (profile: CrmProfile, settings: CrmSettings, now = Date.now()) => {
  const last = profile.last_order_at ? new Date(profile.last_order_at).getTime() : 0;
  if (!last) return false;
  const cutoff = now - (settings.inactive_days || 21) * 24 * 60 * 60 * 1000;
  return last >= cutoff;
};

export async function loadCrmProfiles(): Promise<CrmProfile[]> {
  const { data, error } = await supabase.from('customer_crm_profiles').select('*').limit(5000);
  if (error || !data) return [];
  return data.map((row) => mapCrmProfile(row));
}

export const waMeUrl = (phone: string, text: string) => {
  const d = canonicalPhone(phone) || String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

export const idr = (n: number) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

export const nextTierInfo = (totalSpent: number, settings: CrmSettings) => {
  const spent = Number(totalSpent) || 0;
  const current = evaluateTier(spent, settings);
  if (current === 'Platinum') return { current, next: null as CrmTier | null, threshold: 0, remaining: 0, progress: 1 };
  const next: CrmTier = current === 'Gold' ? 'Platinum' : current === 'Silver' ? 'Gold' : 'Silver';
  const threshold =
    next === 'Platinum'
      ? Number(settings.platinum_threshold) || 0
      : next === 'Gold'
        ? Number(settings.gold_threshold) || 0
        : Number(settings.silver_threshold) || 0;
  const remaining = Math.max(0, threshold - spent);
  const progress = threshold > 0 ? Math.min(1, spent / threshold) : 1;
  return { current, next, threshold, remaining, progress };
};

export const ownerTierGuide = (settings: CrmSettings) =>
  [
    { tier: 'Standard' as CrmTier, rate: settings.standard_rate, threshold: 0 },
    { tier: 'Silver' as CrmTier, rate: settings.silver_rate, threshold: settings.silver_threshold },
    { tier: 'Gold' as CrmTier, rate: settings.gold_rate, threshold: settings.gold_threshold },
    { tier: 'Platinum' as CrmTier, rate: settings.platinum_rate, threshold: settings.platinum_threshold }
  ];
