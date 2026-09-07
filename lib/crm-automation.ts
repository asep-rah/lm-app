import { isOrderFinished } from '@/lib/customerActivity';
import {
  DEFAULT_CRM_SETTINGS,
  addCalendarMonths,
  clampTierWindowMonths,
  crmPhoneKey,
  evaluateTier,
  evaluateTierInWindow,
  isAtRisk,
  isVipChampion,
  loadCrmProfile,
  loadCrmProfiles,
  loadCrmSettings,
  mapCrmProfile,
  rateForTier,
  type CrmProfile,
  type CrmSettings
} from '@/lib/crm';
import { phoneVariants } from '@/lib/csChat';
import { queuePush } from '@/lib/notifications';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { stageKeyOf } from '@/lib/stageTimeline';
import { supabase } from '@/lib/supabaseClient';
import { isVoidTransaction } from '@/lib/voidTx';

const txAmountOf = (tx: any) =>
  Number(tx?.amount ?? tx?.total_amount ?? tx?.grand_total ?? tx?.total ?? 0) || 0;

export const isLoyaltyCompleteOrder = (tx: any) => {
  if (!tx || isVoidTransaction(tx)) return false;
  if (stageKeyOf(tx.status) === 'selesai') return true;
  return isOrderFinished(tx);
};

const alreadyAwarded = async (transactionId: string) => {
  const earned = await supabase
    .from('loyalty_point_logs')
    .select('id')
    .eq('transaction_id', transactionId)
    .eq('kind', 'earn')
    .limit(1);
  if (!earned.error) return Boolean(earned.data?.length);
  const { data } = await supabase
    .from('loyalty_point_logs')
    .select('id')
    .eq('transaction_id', transactionId)
    .limit(1);
  return Boolean(data?.length);
};

export async function sumWindowSpend(phone: string, since: Date, excludeTxId?: string): Promise<number> {
  const variants = phoneVariants(phone);
  if (!variants.length) return 0;
  const { data } = await supabase
    .from('transactions')
    .select('id, amount, total_amount, grand_total, total, status, created_at, customer_phone')
    .in('customer_phone', variants.slice(0, 20))
    .gte('created_at', since.toISOString())
    .limit(2000);
  return (data || []).reduce((sum, row: any) => {
    if (excludeTxId && String(row?.id) === String(excludeTxId)) return sum;
    if (!isLoyaltyCompleteOrder(row)) return sum;
    return sum + txAmountOf(row);
  }, 0);
}

const persistTierWindow = async (
  profile: CrmProfile,
  patch: Partial<CrmProfile>
): Promise<CrmProfile> => {
  const next = { ...profile, ...patch };
  await updateWithFallback(
    'customer_crm_profiles',
    [
      {
        window_spent: next.window_spent,
        tier_level: next.tier_level,
        tier_window_started_at: next.tier_window_started_at,
        total_spent: next.total_spent,
        loyalty_points: next.loyalty_points
      },
      {
        window_spent: next.window_spent,
        tier_level: next.tier_level,
        tier_window_started_at: next.tier_window_started_at
      },
      { tier_level: next.tier_level, total_spent: next.total_spent }
    ],
    { column: 'phone', value: profile.phone }
  );
  return next;
};

/** Hitung ulang belanja jendela N bulan. Saat habis: Platinum → Silver, selain itu Standard. */
export async function syncCrmTierWindow(
  profile: CrmProfile,
  settings: CrmSettings,
  excludeTxId?: string
): Promise<CrmProfile> {
  const months = clampTierWindowMonths(settings.tier_window_months);
  const now = new Date();
  const startedRaw = profile.tier_window_started_at ? new Date(profile.tier_window_started_at) : null;
  const startedOk = startedRaw && !Number.isNaN(startedRaw.getTime());

  if (!startedOk) {
    const started = addCalendarMonths(now, -months);
    const spent = await sumWindowSpend(profile.phone, started, excludeTxId);
    const nextTier = evaluateTierInWindow(spent, profile.tier_level, settings, true);
    return persistTierWindow(profile, {
      window_spent: spent,
      tier_level: nextTier,
      tier_window_started_at: started.toISOString()
    });
  }

  let cursor = startedRaw as Date;
  let lastTier = profile.tier_level;
  let expired = false;
  while (addCalendarMonths(cursor, months).getTime() <= now.getTime()) {
    lastTier = lastTier === 'Platinum' ? 'Silver' : 'Standard';
    cursor = addCalendarMonths(cursor, months);
    expired = true;
  }

  const spent = await sumWindowSpend(profile.phone, cursor, excludeTxId);
  const nextTier = evaluateTierInWindow(spent, lastTier, settings, expired);
  if (
    spent === profile.window_spent &&
    nextTier === profile.tier_level &&
    cursor.toISOString() === profile.tier_window_started_at
  ) {
    return profile;
  }
  return persistTierWindow(profile, {
    window_spent: spent,
    tier_level: nextTier,
    tier_window_started_at: cursor.toISOString()
  });
}

export async function loadFreshCrmProfile(phone?: string | null): Promise<{
  profile: CrmProfile | null;
  settings: CrmSettings;
}> {
  const settings = await loadCrmSettings();
  const existing = await loadCrmProfile(phone);
  if (!existing) return { profile: null, settings };
  const profile = await syncCrmTierWindow(existing, settings);
  return { profile, settings };
}

export async function awardLoyaltyForTransaction(tx: any): Promise<{
  awarded: boolean;
  points?: number;
  tier?: string;
  skipped?: string;
}> {
  if (!isLoyaltyCompleteOrder(tx)) return { awarded: false, skipped: 'not_complete' };
  const transactionId = String(tx?.id || tx?.transaction_id || '');
  if (!transactionId) return { awarded: false, skipped: 'no_id' };
  let row = tx;
  let amount = txAmountOf(row);
  if (amount <= 0) {
    const { data } = await supabase.from('transactions').select('*').eq('id', transactionId).limit(1);
    if (data?.[0]) {
      row = { ...data[0], ...tx, status: tx?.status || data[0].status };
      amount = txAmountOf(row);
    }
  }
  const phone = crmPhoneKey(row?.customer_phone || row?.phone_number);
  if (!phone) return { awarded: false, skipped: 'no_phone' };
  if (amount <= 0) return { awarded: false, skipped: 'no_amount' };

  try {
    if (await alreadyAwarded(transactionId)) return { awarded: false, skipped: 'duplicate' };
  } catch {
    /* tabel belum ada — lanjut, insert akan gagal dengan pesan jelas */
  }

  const settings = await loadCrmSettings();
  let profile = await loadCrmProfile(phone);
  if (!profile) {
    const seeded = {
      phone,
      name: String(row?.customer_name || ''),
      tier_level: 'Standard' as const,
      loyalty_points: 0,
      total_spent: 0,
      window_spent: 0,
      tier_window_started_at: new Date().toISOString(),
      pending_loyalty_discount: 0,
      last_order_at: null,
      last_retention_at: null,
      perfume_pref: 'Standard',
      fold_pref: 'Lipat Rapi',
      special_notes: '',
      outlet_id: row?.outlet_id ? String(row.outlet_id) : null
    };
    await insertWithFallback('customer_crm_profiles', [
      seeded,
      {
        phone,
        name: seeded.name,
        tier_level: 'Standard',
        loyalty_points: 0,
        total_spent: 0,
        window_spent: 0,
        tier_window_started_at: seeded.tier_window_started_at
      },
      { phone, name: seeded.name, tier_level: 'Standard', loyalty_points: 0, total_spent: 0 },
      { phone, tier_level: 'Standard' }
    ]);
    profile = mapCrmProfile(seeded, phone);
  }

  profile = await syncCrmTierWindow(profile, settings, transactionId);

  const rate = rateForTier(profile.tier_level, settings);
  const points = Math.floor(amount * (rate / 100));
  const nextWindow = (Number(profile.window_spent) || 0) + amount;
  const nextSpent = (Number(profile.total_spent) || 0) + amount;
  const nextTier = evaluateTier(nextWindow, settings);
  const nextPoints = (Number(profile.loyalty_points) || 0) + points;
  const now = new Date().toISOString();
  const note =
    nextTier !== profile.tier_level
      ? `Naik tier ${profile.tier_level} → ${nextTier}`
      : `Poin ${rate}% tier ${profile.tier_level}`;

  const { error: logErr } = await insertWithFallback('loyalty_point_logs', [
    {
      customer_phone: profile.phone,
      transaction_id: transactionId,
      points,
      amount,
      rate,
      tier_level: profile.tier_level,
      kind: 'earn',
      note
    },
    {
      customer_phone: profile.phone,
      transaction_id: transactionId,
      points,
      amount,
      note
    }
  ]);
  if (logErr) {
    const msg = String(logErr.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) return { awarded: false, skipped: 'duplicate' };
    return { awarded: false, skipped: logErr.message };
  }

  await updateWithFallback(
    'customer_crm_profiles',
    [
      {
        loyalty_points: nextPoints,
        total_spent: nextSpent,
        window_spent: nextWindow,
        tier_level: nextTier,
        last_order_at: now,
        name: row?.customer_name || profile.name,
        outlet_id: row?.outlet_id || profile.outlet_id
      },
      {
        loyalty_points: nextPoints,
        total_spent: nextSpent,
        window_spent: nextWindow,
        tier_level: nextTier,
        last_order_at: now
      },
      {
        loyalty_points: nextPoints,
        total_spent: nextSpent,
        tier_level: nextTier,
        last_order_at: now
      },
      { loyalty_points: nextPoints, total_spent: nextSpent, tier_level: nextTier }
    ],
    { column: 'phone', value: profile.phone }
  );

  return { awarded: true, points, tier: nextTier };
}

export const maybeAwardLoyalty = (tx: any) => {
  if (!tx) return;
  void awardLoyaltyForTransaction(tx).catch((err) => {
    console.warn('CRM loyalty:', err?.message || err);
  });
};

export type CrmAnalytics = {
  settings: CrmSettings;
  profiles: CrmProfile[];
  active: CrmProfile[];
  atRisk: CrmProfile[];
  vip: CrmProfile[];
  repeatOrderRate: number;
  avgLtv: number;
  totalPointsIssued: number;
  totalCustomers: number;
};

export async function loadCrmAnalytics(): Promise<CrmAnalytics> {
  const settings = await loadCrmSettings();
  let profiles = await loadCrmProfiles();

  if (!profiles.length) {
    const { data: customers } = await supabase.from('customers').select('phone, name').limit(3000);
    profiles = (customers || [])
      .map((c: any) =>
        mapCrmProfile(
          {
            phone: crmPhoneKey(c.phone),
            name: c.name,
            tier_level: 'Standard',
            loyalty_points: 0,
            total_spent: 0
          },
          crmPhoneKey(c.phone)
        )
      )
      .filter((p) => p.phone);
  }

  const active = profiles.filter((p) => !isAtRisk(p, settings) && p.last_order_at);
  const atRisk = profiles.filter((p) => isAtRisk(p, settings));
  const vip = profiles.filter(isVipChampion);

  const phones = profiles.map((p) => p.phone).filter(Boolean);
  let repeatOrderRate = 0;
  if (phones.length) {
    const variants = Array.from(new Set(phones.flatMap((p) => phoneVariants(p))));
    const { data: txs } = await supabase
      .from('transactions')
      .select('customer_phone, status')
      .in('customer_phone', variants.slice(0, 1000));
    const counts = new Map<string, number>();
    (txs || []).forEach((t: any) => {
      if (isVoidTransaction(t) || !isLoyaltyCompleteOrder(t)) return;
      const key = crmPhoneKey(t.customer_phone);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const withOrder = [...counts.values()];
    const repeaters = withOrder.filter((n) => n >= 2).length;
    repeatOrderRate = withOrder.length ? Math.round((repeaters / withOrder.length) * 1000) / 10 : 0;
  }

  const avgLtv = profiles.length
    ? Math.round(profiles.reduce((s, p) => s + (Number(p.total_spent) || 0), 0) / profiles.length)
    : 0;
  const totalPointsIssued = profiles.reduce((s, p) => s + (Number(p.loyalty_points) || 0), 0);

  return {
    settings,
    profiles,
    active,
    atRisk,
    vip,
    repeatOrderRate,
    avgLtv,
    totalPointsIssued,
    totalCustomers: profiles.length
  };
}

export async function runRetentionSweep(): Promise<{ sent: number; skipped: number }> {
  const settings = (await loadCrmSettings()) || DEFAULT_CRM_SETTINGS;
  const profiles = await loadCrmProfiles();
  const now = Date.now();
  const cooldownMs = (settings.inactive_days || 21) * 24 * 60 * 60 * 1000;
  let sent = 0;
  let skipped = 0;

  for (const profile of profiles) {
    if (!isAtRisk(profile, settings, now)) {
      skipped += 1;
      continue;
    }
    const lastPush = profile.last_retention_at ? new Date(profile.last_retention_at).getTime() : 0;
    if (lastPush && now - lastPush < cooldownMs) {
      skipped += 1;
      continue;
    }
    const rate = rateForTier(profile.tier_level, settings);
    const body =
      settings.retention_message ||
      `Sudah ${settings.inactive_days} hari belum cuci. Nikmati cashback ${rate}% poin di tier ${profile.tier_level}. Yuk order lagi!`;
    queuePush({
      kind: 'crm_retention',
      phone: profile.phone,
      title: 'Kami rindu cucian Anda',
      body,
      url: '/customer/dashboard?tab=home'
    });
    await updateWithFallback(
      'customer_crm_profiles',
      [{ last_retention_at: new Date(now).toISOString() }, { last_order_at: profile.last_order_at }],
      { column: 'phone', value: profile.phone }
    );
    await insertWithFallback('loyalty_point_logs', [
      {
        customer_phone: profile.phone,
        points: 0,
        amount: 0,
        rate,
        tier_level: profile.tier_level,
        kind: 'retention',
        note: body
      },
      { customer_phone: profile.phone, points: 0, amount: 0, note: body }
    ]);
    sent += 1;
  }

  return { sent, skipped };
}

export function filterCrmAudience(opts: {
  profiles: CrmProfile[];
  settings: CrmSettings;
  outletId?: string;
  tier?: string;
  segment?: 'all' | 'active' | 'at_risk' | 'vip';
}) {
  const outlet = String(opts.outletId || '').trim();
  const tier = String(opts.tier || '').trim();
  const segment = opts.segment || 'all';
  return opts.profiles.filter((p) => {
    if (outlet && outlet !== 'ALL' && String(p.outlet_id || '') !== outlet) return false;
    if (tier && tier !== 'ALL' && p.tier_level !== tier) return false;
    if (segment === 'active') return !isAtRisk(p, opts.settings) && Boolean(p.last_order_at);
    if (segment === 'at_risk') return isAtRisk(p, opts.settings);
    if (segment === 'vip') return isVipChampion(p);
    return true;
  });
}
