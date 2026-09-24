import { NextResponse } from 'next/server';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import { requirePaymentOpsAuth } from '@/lib/requirePaymentOpsAuth';
import { isPaymentLocked } from '@/lib/paymentVerify';
import { envAuditFlags } from '@/lib/supabaseEnv';
import { customerWaLoginChecks } from '@/lib/customerAuth/server';

export const dynamic = 'force-dynamic';

/** Data diagnosis sistem — hanya staf terautentikasi (bukan anon publik). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await requirePaymentOpsAuth(
    req,
    {
      staffId: url.searchParams.get('staffId') || '',
      agentName: url.searchParams.get('agentName') || 'Owner',
      role: url.searchParams.get('role') || 'owner'
    },
    'resync'
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const summaryOnly = url.searchParams.get('summary') === '1';

  try {
    const db = paymentServiceDb();

    if (summaryOnly) {
      const [{ count: errCount }, { data: txs }] = await Promise.all([
        db
          .from('error_logs')
          .select('id', { count: 'exact', head: true })
          .eq('resolved', false),
        db
          .from('transactions')
          .select('id, payment_status, is_paid, status')
          .order('created_at', { ascending: false })
          .limit(60)
      ]);
      const pendingPay = (txs || []).filter((t: any) => isPaymentLocked(t)).length;
      return NextResponse.json({
        errorCount: Number(errCount) || 0,
        pendingPayCount: pendingPay,
        unread: (Number(errCount) || 0) + pendingPay
      });
    }

    const [{ data: errs }, { data: hooks }, txRes] = await Promise.all([
      db.from('error_logs').select('*').order('created_at', { ascending: false }).limit(40),
      db
        .from('webhook_logs')
        .select(
          'id, gateway, status, event_type, signature_ok, error_message, created_at, transaction_id'
        )
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('transactions')
        .select(
          'id, receipt_number, amount, customer_phone, customer_name, payment_status, is_paid, status, created_at, outlet_id, payment_method, mayar_payment_id, paid_via, outlets(name)'
        )
        .order('created_at', { ascending: false })
        .limit(40)
    ]);

    let txs: any[] | null = txRes.data as any[] | null;
    if (txRes.error) {
      const fallback = await db
        .from('transactions')
        .select(
          'id, receipt_number, amount, customer_phone, customer_name, payment_status, is_paid, status, created_at, outlet_id, payment_method, mayar_payment_id'
        )
        .order('created_at', { ascending: false })
        .limit(40);
      txs = (fallback.data as any[] | null) || null;
    }

    const pendingRows = (txs || []).filter((t: any) => isPaymentLocked(t)).slice(0, 12);
    let outletNames: Record<string, string> = {};
    if (pendingRows.some((t: any) => !t.outlets?.name && t.outlet_id)) {
      const ids = [...new Set(pendingRows.map((t: any) => t.outlet_id).filter(Boolean))];
      if (ids.length) {
        const { data: outs } = await db.from('outlets').select('id, name').in('id', ids);
        outletNames = Object.fromEntries((outs || []).map((o: any) => [o.id, o.name]));
      }
    }

    const pending = pendingRows.map((t: any) => {
      const created = t.created_at ? new Date(t.created_at).getTime() : NaN;
      const pendingHours = Number.isFinite(created)
        ? Math.max(0, Math.round((Date.now() - created) / 36e5))
        : null;
      return {
        ...t,
        outlet_name: t.outlets?.name || outletNames[String(t.outlet_id || '')] || null,
        pending_hours: pendingHours
      };
    });

    return NextResponse.json({
      errors: errs || [],
      webhooks: hooks || [],
      pending,
      env: envAuditFlags(),
      customerLogin: customerWaLoginChecks()
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Gagal muat diagnosis', env: envAuditFlags() }, { status: 500 });
  }
}
