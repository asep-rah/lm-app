import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SUPABASE_URL, isSupabaseApiUrl } from '@/lib/supabaseEnv';

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_URL = isSupabaseApiUrl(rawUrl) ? rawUrl.replace(/\/+$/, '') : DEFAULT_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
