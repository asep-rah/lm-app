import { NextResponse } from 'next/server';
import { normalizeDeployEnv, resolveSupabaseTarget, supabaseRefOfKey } from '@/lib/supabaseTarget';
import { serverDeployEnv, serverServiceKey, serverSupabaseTarget } from '@/lib/supabaseServer';
import { checkSupabaseKey } from '@/lib/supabaseKeyCheck';

export const dynamic = 'force-dynamic';

/**
 * Bukti target database sebelum menguji sebuah deployment (tanpa secret):
 * project ref yang dipakai browser & server, dan apakah itu produksi.
 * Jangan uji Preview kecuali `safeForTesting` bernilai true.
 *
 * `?verify=1` (hanya non-produksi): minta proyek target sendiri menerima/menolak
 * anon key & service key. Hanya status yang dikembalikan — tidak ada kunci
 * maupun isi respons.
 */
export async function GET(req: Request) {
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
  const wantVerify = new URL(req.url).searchParams.get('verify') === '1';
  let verify: Record<string, unknown> | undefined;
  if (wantVerify) {
    if (deployEnv === 'production') {
      verify = { skipped: 'production' };
    } else if (!server.ok) {
      verify = { skipped: 'target blocked' };
    } else {
      const [anon, service] = await Promise.all([
        checkSupabaseKey(server.url, server.anonKey, 'anon'),
        checkSupabaseKey(server.url, serviceKey, 'service')
      ]);
      verify = { anonKey: anon, serviceKey: service, readyForStagingTests: safeForTesting && anon.accepted && service.accepted };
    }
  }
  return NextResponse.json(
    {
      verify,
      deployEnv,
      browser: view(browser),
      server: view(server),
      serviceRole: serviceKey ? { configured: true, projectRef: supabaseRefOfKey(serviceKey) } : { configured: false },
      safeForTesting
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
