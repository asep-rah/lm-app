import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeServerOrderTotal, insertAuditLog, insertErrorLog, clientIp } from '@/lib/paymentSecurity';
import { PENDING_PAY_STATUS } from '@/lib/paymentVerify';

export const dynamic = 'force-dynamic';

/**
 * Server-authoritative order create — total dihitung di server, bukan dari client.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const lines = Array.isArray(body.lines) ? body.lines : Array.isArray(body.items) ? body.items : [];
    const computed = computeServerOrderTotal({
      lines: lines.map((l: any) => ({
        unitPrice: l.unitPrice ?? l.price ?? l.basePrice,
        qty: l.qty ?? l.quantity ?? 1,
        kg: l.kg ?? l.weight_kg
      })),
      deliveryFee: body.deliveryFee ?? body.delivery_fee,
      discount: body.discount ?? body.discount_amount,
      clientAmount: body.amount ?? body.total_amount
    });

    if (computed.mismatch) {
      await insertErrorLog({
        source: 'order_create',
        code: 'AMOUNT_MISMATCH',
        message: `Client amount ${computed.clientAmount} ≠ server ${computed.total}`,
        context: computed
      });
      return NextResponse.json(
        {
          error: 'Nominal tidak valid. Total dihitung ulang di server.',
          serverTotal: computed.total,
          clientAmount: computed.clientAmount
        },
        { status: 400 }
      );
    }

    if (computed.total < 0) {
      return NextResponse.json({ error: 'Total tidak valid' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );

    const method = String(body.payment_method || body.paymentMethod || 'QRIS');
    const nonCash = /qris|transfer/i.test(method);
    const payload: Record<string, unknown> = {
      customer_name: body.customer_name || body.customerName || 'Pelanggan',
      customer_phone: body.customer_phone || body.customerPhone || '',
      outlet_id: body.outlet_id || body.outletId || null,
      service_type: body.service_type || body.serviceType || 'Laundry',
      amount: computed.total,
      delivery_fee: computed.delivery,
      discount_amount: computed.discount,
      payment_method: method,
      payment_status: nonCash ? PENDING_PAY_STATUS : 'paid',
      is_paid: !nonCash,
      status: nonCash ? PENDING_PAY_STATUS : body.status || 'Diterima',
      receipt_number: body.receipt_number || body.receipt || `TRX-${Date.now().toString(36).toUpperCase()}`,
      items: body.items || body.lines || null,
      notes: body.notes || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('transactions').insert([payload]).select('*').limit(1);
    if (error) {
      await insertErrorLog({ source: 'order_create', message: error.message, context: payload });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const tx = data?.[0];
    void insertAuditLog({
      action: 'ORDER_CREATE_SERVER',
      entity_type: 'transactions',
      entity_id: tx?.id,
      amount: computed.total,
      meta: { subtotal: computed.subtotal, delivery: computed.delivery, discount: computed.discount },
      ip_address: clientIp(req)
    });

    return NextResponse.json({
      ok: true,
      transaction: tx,
      totals: computed
    });
  } catch (err: any) {
    await insertErrorLog({ source: 'order_create', message: err?.message || 'create failed' });
    return NextResponse.json({ error: err?.message || 'Gagal buat order' }, { status: 500 });
  }
}
