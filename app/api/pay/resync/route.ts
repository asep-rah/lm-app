import { NextResponse } from 'next/server';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, clientIp, paymentServiceDb } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';
import { resolveMayarApiKey } from '@/lib/mayarOutletKey';
import { requirePaymentOpsAuth } from '@/lib/requirePaymentOpsAuth';

export const dynamic = 'force-dynamic';

/** One-click re-sync for a failed/pending transaction from system-health panel. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await requirePaymentOpsAuth(req, body, 'resync');
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const transactionId = String(body.transactionId || body.transaction_id || '').trim();
    const errorLogId = String(body.errorLogId || '').trim();
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId wajib' }, { status: 400 });
    }

    const supabase = paymentServiceDb();
    const { data: tx } = await supabase.from('transactions').select('*').eq('id', transactionId).maybeSingle();
    if (!tx) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    if (!isPaymentLocked(tx)) {
      if (errorLogId) {
        await supabase
          .from('error_logs')
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: auth.agentName })
          .eq('id', errorLogId);
      }
      return NextResponse.json({ status: 'already_paid', is_paid: true });
    }

    const paymentId = String(tx.mayar_payment_id || '').trim();
    const apiKey = await resolveMayarApiKey(supabase, tx.outlet_id);
    let paid = false;

    if (paymentId && apiKey && !paymentId.startsWith('mock_')) {
      try {
        const res = await fetch(`https://api.mayar.id/hl/v1/payment/${encodeURIComponent(paymentId)}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
        });
        if (res.ok) {
          const gw = await res.json();
          if (isMayarPaidEvent(gw)) paid = true;
        }
      } catch (err: any) {
        await insertErrorLog({
          source: 'pay_resync',
          code: 'API_TIMEOUT',
          message: err?.message || 'Gateway timeout',
          transaction_id: transactionId
        });
      }
    }

    // force hanya owner — sudah dicek di requirePaymentOpsAuth roles
    if (paid || (body.force === true && auth.role === 'owner')) {
      const { error } = await markGatewayPaid({
        transactionId: tx.id,
        receipt: tx.receipt_number,
        amount: Number(tx.amount || 0),
        agentName: auth.agentName,
        customerPhone: tx.customer_phone,
        paidVia: body.force && !paid ? 'MANUAL_VERIFIED' : 'CRON_SYNC'
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (errorLogId) {
        await supabase
          .from('error_logs')
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: auth.agentName })
          .eq('id', errorLogId);
      }
      void insertAuditLog({
        user_name: auth.agentName,
        role: auth.role,
        action: 'PAYMENT_RESYNC',
        entity_type: 'transactions',
        entity_id: transactionId,
        amount: Number(tx.amount || 0),
        ip_address: clientIp(req),
        meta: { staffId: auth.staffId, forced: Boolean(body.force && !paid) }
      });
      return NextResponse.json({ status: 'success', is_paid: true });
    }

    return NextResponse.json({
      status: 'still_pending',
      message: 'Gateway belum melaporkan lunas. Gunakan Tandai Lunas Manual jika sudah diverifikasi mutasi.'
    });
  } catch (err: any) {
    await insertErrorLog({ source: 'pay_resync', message: err?.message || 'resync failed' });
    return NextResponse.json({ error: err?.message || 'Gagal' }, { status: 500 });
  }
}
