import { NextResponse } from 'next/server';
import { runRetentionSweep } from '@/lib/crm-automation';

export const dynamic = 'force-dynamic';

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
  try {
    const result = await runRetentionSweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Gagal retention sweep' }, { status: 500 });
  }
};

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
