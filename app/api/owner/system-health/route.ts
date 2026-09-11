import { NextResponse } from 'next/server';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import { requirePaymentOpsAuth } from '@/lib/requirePaymentOpsAuth';
import { isPaymentLocked } from '@/lib/paymentVerify';
import { envAuditFlags } from '@/lib/supabaseEnv';

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

    const [{ data: errs }, { data: hooks }, { data: txs }] = await Promise.all([
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
          'id, receipt_number, amount, customer_phone, customer_name, payment_status, is_paid, status, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(40)
    ]);

    return NextResponse.json({
      errors: errs || [],
      webhooks: hooks || [],
      pending: (txs || []).filter((t: any) => isPaymentLocked(t)).slice(0, 12),
      env: envAuditFlags()
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Gagal muat diagnosis', env: envAuditFlags() }, { status: 500 });
  }
}
