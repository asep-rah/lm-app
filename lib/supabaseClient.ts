import { createClient } from '@supabase/supabase-js';

// Sebelumnya file ini hanya berisi `export const supabase: any = {}`, sehingga
// setiap komponen yang mengimpornya (OutletIssueForm, HeadTaskDelegator,
// utils/taskSlaEvaluator) langsung error "supabase.from is not a function" saat
// dipakai. Tipe `any` membuat TypeScript tidak menangkapnya.
//
// Nilai fallback memakai kredensial publik yang sama dengan yang ditulis manual
// di tiap halaman (app/pos, app/owner, dst), supaya perilakunya identik.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
