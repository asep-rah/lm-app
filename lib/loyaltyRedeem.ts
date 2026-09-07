import {
  crmPhoneKey,
  idr,
  loadCrmProfile,
  loadCrmSettings,
  parseRedeemAmounts,
  type CrmProfile,
  type CrmSettings
} from '@/lib/crm';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';

export const redeemableAmounts = (settings?: CrmSettings | null) =>
  parseRedeemAmounts(settings?.redeem_amounts);

export const canRedeemAmount = (points: number, amount: number, settings?: CrmSettings | null) => {
  const allowed = redeemableAmounts(settings);
  return allowed.includes(Math.round(amount)) && Number(points) >= amount && amount > 0;
};

export async function setPendingLoyaltyRedeem(
  phone: string,
  amount: number
): Promise<{ error: string | null; profile: CrmProfile | null; settings: CrmSettings }> {
  const settings = await loadCrmSettings();
  const key = crmPhoneKey(phone);
  const profile = await loadCrmProfile(key);
  if (!profile) return { error: 'Profil loyalty tidak ditemukan', profile: null, settings };
  const value = Math.round(amount);
  if (value === 0) {
    await updateWithFallback(
      'customer_crm_profiles',
      [{ pending_loyalty_discount: 0 }],
      { column: 'phone', value: profile.phone }
    );
    return { error: null, profile: { ...profile, pending_loyalty_discount: 0 }, settings };
  }
  if (!canRedeemAmount(profile.loyalty_points, value, settings)) {
    return {
      error: `Poin tidak cukup atau nominal bukan ${redeemableAmounts(settings).map(idr).join(', ')}`,
      profile,
      settings
    };
  }
  const { error } = await updateWithFallback(
    'customer_crm_profiles',
    [{ pending_loyalty_discount: value }],
    { column: 'phone', value: profile.phone }
  );
  if (error) return { error: error.message, profile, settings };
  return { error: null, profile: { ...profile, pending_loyalty_discount: value }, settings };
}

export async function redeemLoyaltyPoints(opts: {
  phone: string;
  amount: number;
  note?: string;
}): Promise<{ error: string | null; pointsLeft: number; amount: number }> {
  const settings = await loadCrmSettings();
  const key = crmPhoneKey(opts.phone);
  const profile = await loadCrmProfile(key);
  const amount = Math.round(Number(opts.amount) || 0);
  if (!profile) return { error: 'Profil loyalty tidak ditemukan', pointsLeft: 0, amount: 0 };
  if (!canRedeemAmount(profile.loyalty_points, amount, settings)) {
    return {
      error: `Poin tidak cukup. Klaim hanya ${redeemableAmounts(settings).map(idr).join(', ')}.`,
      pointsLeft: Number(profile.loyalty_points) || 0,
      amount: 0
    };
  }

  const nextPoints = Math.max(0, Math.round(Number(profile.loyalty_points) || 0) - amount);
  const { error: logErr } = await insertWithFallback('loyalty_point_logs', [
    {
      customer_phone: profile.phone,
      points: -amount,
      amount,
      rate: 0,
      tier_level: profile.tier_level,
      kind: 'redeem',
      note: opts.note || `Tukar poin potongan ${idr(amount)}`
    },
    {
      customer_phone: profile.phone,
      points: -amount,
      amount,
      note: opts.note || `Tukar poin potongan ${idr(amount)}`
    }
  ]);
  if (logErr) return { error: logErr.message, pointsLeft: Number(profile.loyalty_points) || 0, amount: 0 };

  const { error } = await updateWithFallback(
    'customer_crm_profiles',
    [
      { loyalty_points: nextPoints, pending_loyalty_discount: 0 },
      { loyalty_points: nextPoints }
    ],
    { column: 'phone', value: profile.phone }
  );
  if (error) return { error: error.message, pointsLeft: Number(profile.loyalty_points) || 0, amount: 0 };
  return { error: null, pointsLeft: nextPoints, amount };
}
