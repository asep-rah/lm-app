import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isPaymentLocked, markGatewayPaid } from '@/lib/paymentVerify';
import { insertAuditLog, insertErrorLog, clientIp } from '@/lib/paymentSecurity';
import { isMayarPaidEvent } from '@/lib/mayar';

export const dynamic = 'force-dynamic';

/** One-click re-sync for a failed/pending transaction from system-health panel. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const transactionId = String(body.transactionId || body.transaction_id || '').trim();
    const errorLogId = String(body.errorLogId || '').trim();
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId wajib' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );

    const { data: tx } = await supabase.from('transactions').select('*').eq('id', transactionId).maybeSingle();
    if (!tx) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    if (!isPaymentLocked(tx)) {
      if (errorLogId) {
        await supabase
          .from('error_logs')
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: body.agentName || 'Owner' })
          .eq('id', errorLogId);
      }
      return NextResponse.json({ status: 'already_paid', is_paid: true });
    }

    const paymentId = String(tx.mayar_payment_id || '').trim();
    const apiKey = String(process.env.MAYAR_API_KEY || '').trim();
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

    if (paid || body.force === true) {
      const { error } = await markGatewayPaid({
        transactionId: tx.id,
        receipt: tx.receipt_number,
        amount: Number(tx.amount || 0),
        agentName: body.agentName || 'Owner Re-sync',
        customerPhone: tx.customer_phone,
        paidVia: body.force ? 'MANUAL_VERIFIED' : 'CRON_SYNC'
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (errorLogId) {
        await supabase
          .from('error_logs')
          .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: body.agentName || 'Owner' })
          .eq('id', errorLogId);
      }
      void insertAuditLog({
        user_name: body.agentName || 'Owner',
        role: 'owner',
        action: 'PAYMENT_RESYNC',
        entity_type: 'transactions',
        entity_id: transactionId,
        amount: Number(tx.amount || 0),
        ip_address: clientIp(req)
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
