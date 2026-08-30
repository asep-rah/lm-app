import { createClient } from '@supabase/supabase-js';
import {
  answerOwnerQuestion,
  buildCopilotMetrics,
  buildExecutiveContext,
  loadAnalyticsBundle,
  resolveScopedOutletIds,
  type CopilotPeriod
} from '@/lib/aiCopilotAnalytics';

export const dynamic = 'force-dynamic';

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
  );

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const question = String(body.question || body.userQuery || '').trim();
    if (!question) {
      return Response.json({ ok: false, error: 'Pertanyaan kosong' }, { status: 400 });
    }

    const period = (String(body.period || 'THIS_MONTH').toUpperCase() || 'THIS_MONTH') as CopilotPeriod;
    const supabase = db();

    const [{ data: settings }, { data: outlets }] = await Promise.all([
      supabase.from('app_settings').select('supervisor_mapping').eq('id', 1).maybeSingle(),
      supabase.from('outlets').select('id, name')
    ]);

    let mapping: Record<string, string> = {};
    try {
      const raw = settings?.supervisor_mapping;
      mapping = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
    } catch {
      mapping = {};
    }

    const outletIds = resolveScopedOutletIds({
      scope: body.scope,
      outletId: body.outletId,
      accessOutlets: body.accessOutlets,
      supervisorName: body.supervisorName,
      mapping
    });

    const bundle = await loadAnalyticsBundle(supabase, outletIds, period);
    const metrics = buildCopilotMetrics(bundle.txs, bundle.expenses, bundle.tasks);
    const context = buildExecutiveContext(
      metrics,
      bundle.txs,
      bundle.expenses,
      bundle.tasks,
      (outlets || []).filter((o: any) => !outletIds || outletIds.includes(o.id)),
      mapping,
      bundle.historyTxs || bundle.txs
    );

    const { reply, source } = await answerOwnerQuestion(question, context);
    return Response.json({ ok: true, reply, source, context });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || 'Gagal menjawab pertanyaan' }, { status: 500 });
  }
}
