import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabaseServer';
import { runFinanceReconEngine } from '@/lib/financeRecon';

export const dynamic = 'force-dynamic';

const supabase = serverSupabase();

const authorized = (req: Request) => {
  const expected = process.env.CRON_SECRET || process.env.CLEANUP_CRON_SECRET || '';
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.headers.get('x-cron-secret') ||
    '';
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) return Boolean(expected) && header === expected;
  if (expected) return header === expected;
  return true;
};

const run = async (req: Request) => {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.max(2, Math.min(14, Number(url.searchParams.get('days')) || 3));
  const result = await runFinanceReconEngine(supabase, { days });
  if (!result.ok && result.reconUpserts === 0) {
    return NextResponse.json({ error: result.error || 'Rekonsiliasi gagal' }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    days: result.days,
    reconUpserts: result.reconUpserts,
    alertsCreated: result.alertsCreated,
    warning: result.error || null
  });
};

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
