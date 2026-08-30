import { createClient } from '@supabase/supabase-js';
import {
  buildCopilotMetrics,
  buildGrowthReport,
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
    const period = (String(body.period || 'THIS_MONTH').toUpperCase() || 'THIS_MONTH') as CopilotPeriod;
    const supabase = db();

    let mapping: Record<string, string> = {};
    if (String(body.scope || '') === 'supervisor') {
      const { data: settings } = await supabase.from('app_settings').select('supervisor_mapping').eq('id', 1).maybeSingle();
      const raw = settings?.supervisor_mapping;
      try {
        mapping = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
      } catch {
        mapping = {};
      }
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
    const report = buildGrowthReport(metrics, bundle.historyTxs || bundle.txs);

    return Response.json({
      ok: true,
      period,
      outletIds,
      metrics,
      insights: report.insights,
      summary: report.summary,
      source: report.source
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || 'Gagal memuat analitik' }, { status: 500 });
  }
}
