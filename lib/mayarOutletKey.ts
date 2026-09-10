import type { SupabaseClient } from '@supabase/supabase-js';
import { isMayarKeyValid } from '@/lib/mayar';

/** Resolusi API key Mayar: outlet dulu, lalu env global. */
export async function resolveMayarApiKey(
  db: SupabaseClient,
  outletId?: string | null
): Promise<string> {
  const oid = String(outletId || '').trim();
  if (oid) {
    const { data } = await db
      .from('outlets')
      .select('mayar_api_key')
      .eq('id', oid)
      .maybeSingle();
    const key = String(data?.mayar_api_key || '').trim();
    if (isMayarKeyValid(key)) return key;
  }
  return String(process.env.MAYAR_API_KEY || '').trim();
}
