import { NextResponse } from 'next/server';
import { normalizeDeployEnv, resolveSupabaseTarget, supabaseRefOfKey } from '@/lib/supabaseTarget';
import { serverDeployEnv, serverServiceKey, serverSupabaseTarget } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Bukti target database sebelum menguji sebuah deployment (tanpa secret):
 * project ref yang dipakai browser & server, dan apakah itu produksi.
 * Jangan uji Preview kecuali `safeForTesting` bernilai true.
 */
export async function GET() {
  const browser = resolveSupabaseTarget({
    deployEnv: normalizeDeployEnv(process.env.NEXT_PUBLIC_LM_DEPLOY_ENV),
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  });
  const server = serverSupabaseTarget();
  const serviceKey = serverServiceKey();
  const view = (t: typeof server) => ({
    ok: t.ok,
    projectRef: t.projectRef,
    isProductionDb: t.isProductionDb,
    blockedReason: t.ok ? null : t.reason
  });
  const deployEnv = serverDeployEnv();
  const safeForTesting =
    deployEnv !== 'production' &&
    browser.ok &&
    server.ok &&
    !browser.isProductionDb &&
    !server.isProductionDb &&
    browser.projectRef === server.projectRef;
  return NextResponse.json(
    {
      deployEnv,
      browser: view(browser),
      server: view(server),
      serviceRole: serviceKey ? { configured: true, projectRef: supabaseRefOfKey(serviceKey) } : { configured: false },
      safeForTesting
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
