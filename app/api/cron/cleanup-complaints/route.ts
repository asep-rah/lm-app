import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

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

const runCleanup = async (req: Request) => {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase.rpc('cleanup_resolved_complaint_tickets');
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('could not find') || msg.includes('does not exist') || msg.includes('schema cache')) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: stale } = await supabase
        .from('complaint_tickets')
        .select('id')
        .eq('status', 'resolved')
        .lt('resolved_at', cutoff);
      const ids = (stale || []).map((r: any) => r.id).filter(Boolean);
      if (ids.length) {
        await supabase.from('complaint_chat_messages').delete().in('ticket_id', ids);
        await supabase.from('complaint_tickets').delete().in('id', ids);
      }
      return NextResponse.json({ ok: true, deleted: ids.length, fallback: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: Number(data) || 0 });
};

export async function GET(req: Request) {
  return runCleanup(req);
}

export async function POST(req: Request) {
  return runCleanup(req);
}
