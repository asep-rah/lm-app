import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertErrorLog } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

const ALLOWED_STAGES = new Set(['pickup_order_create']);

/**
 * Best-effort technical-error sink for the customer order form. The browser
 * never shows a raw database error to the customer (see submitValidatedOrder
 * in app/customer/dashboard/page.tsx); it POSTs the technical detail here
 * instead, so Owner/Admin Ops can still investigate it via Diagnosa Sistem
 * (app/api/owner/system-health reads the same error_logs table).
 *
 * No secrets involved: this route only writes to error_logs through the
 * existing service-role-gated insertErrorLog() helper. Unauthenticated by
 * design (the customer isn't logged in as staff) — same trust level as the
 * public Mayar/Xendit webhook routes that already log into this table.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const stage = ALLOWED_STAGES.has(String(body?.stage || '')) ? String(body.stage) : 'pickup_order_create';
    const message = String(body?.message || '').trim().slice(0, 500);
    if (!message) return NextResponse.json({ ok: false }, { status: 400 });
    const context = body?.context && typeof body.context === 'object' ? { ...body.context, ip: clientIp(req) } : { ip: clientIp(req) };

    await insertErrorLog({
      source: 'customer_order_form',
      code: stage,
      message,
      context,
      hint: 'Gagal membuat pesanan online dari /customer/dashboard. Cek payload di context.'
    });
  } catch {
    /* best-effort: never block the customer on a logging failure */
  }
  // Always 200 — this is a fire-and-forget diagnostic call, not part of the
  // order flow itself.
  return NextResponse.json({ ok: true });
}
