import { supabase } from '@/lib/supabaseClient';
import { updateWithFallback } from '@/lib/safeWrite';

export const DEFAULT_PROFIT_SHARE_PCT = 20;
const LS_KEY = 'laundry_profit_share_by_outlet';

const safeParse = (raw: any): Record<string, number> => {
  if (!raw) return {};
  const obj = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, number> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (k.startsWith('__')) return;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  });
  return out;
};

export async function loadProfitShareRates(): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('app_settings')
    .select('profit_share_by_outlet, outlet_overrides')
    .eq('id', 1)
    .maybeSingle();
  const fromCol = safeParse(data?.profit_share_by_outlet);
  if (Object.keys(fromCol).length) return fromCol;
  const overrides = safeParse(data?.outlet_overrides);
  const nested = safeParse((data?.outlet_overrides && typeof data.outlet_overrides === 'object'
    ? (data.outlet_overrides as any).__profit_share
    : null) || (typeof data?.outlet_overrides === 'string'
    ? (() => { try { return JSON.parse(data.outlet_overrides).__profit_share; } catch { return null; } })()
    : null));
  if (Object.keys(nested).length) return nested;
  if (Object.keys(overrides).length && Object.values(overrides).every((v) => typeof v === 'number')) return overrides;
  try {
    return safeParse(localStorage.getItem(LS_KEY));
  } catch {
    return {};
  }
}

export async function saveProfitShareRates(rates: Record<string, number>): Promise<{ error: string | null }> {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rates));
  } catch {
    /* ignore */
  }

  const { data: settings } = await supabase
    .from('app_settings')
    .select('outlet_overrides')
    .eq('id', 1)
    .maybeSingle();

  let overrides: any = {};
  try {
    overrides = typeof settings?.outlet_overrides === 'string'
      ? JSON.parse(settings.outlet_overrides || '{}')
      : (settings?.outlet_overrides || {});
  } catch {
    overrides = {};
  }
  if (!overrides || typeof overrides !== 'object') overrides = {};
  overrides.__profit_share = rates;

  const { error } = await updateWithFallback(
    'app_settings',
    [
      { profit_share_by_outlet: rates, outlet_overrides: JSON.stringify(overrides) },
      { profit_share_by_outlet: rates },
      { outlet_overrides: JSON.stringify(overrides) }
    ],
    { column: 'id', value: 1 }
  );
  return { error: error?.message || null };
}
