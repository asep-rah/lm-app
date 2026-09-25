import { NextResponse, type NextRequest } from 'next/server';
import { isOrderId } from '@/lib/driverChatServer';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { samePhone } from '@/lib/phone';
import { checkPinCorrection } from '@/lib/pickupPinCorrection';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { distanceM, toLatLon } from '@/lib/serviceArea';
import { readStaffSession, staffSessionError, staffSessionProblem } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The assigned driver, at the customer's gate, saves the phone GPS as the
 * pickup point (lib/pickupPinCorrection). Updates pickup_orders.latitude/
 * longitude and — when the order came from a saved address of the same
 * customer — that customer_addresses row, so the next pickup is accurate.
 * Driver role re-read from employees; the old and new point are audited.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu sering. Coba lagi beberapa menit lagi.');
  const session = readStaffSession(req);
  if (!session) {
    const e = staffSessionError(staffSessionProblem(req) === 'not_configured' ? 'not_configured' : 'missing');
    return NextResponse.json(e.body, { status: e.status, headers: noStore });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = String(body.orderId || '');
  if (!isOrderId(orderId)) return deny(400, 'Pesanan tidak valid.');

  try {
    const db = paymentServiceDb();
    const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
    if (!staff) return deny(401, 'Akun tidak ditemukan. Masuk lagi.');
    if (String(staff.role || '').toLowerCase() !== 'driver') return deny(403, 'Perbaikan titik jemput hanya untuk driver.');

    const { data: order, error: orderErr } = await db
      .from('pickup_orders')
      .select('id, order_number, status, driver_name, outlet_id, customer_phone, latitude, longitude, address_id')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr) throw new Error(`${orderErr.code ?? ''} ${orderErr.message}`.trim());

    let outlet: { latitude?: unknown; longitude?: unknown } | null = null;
    if (order?.outlet_id) {
      const { data } = await db.from('outlets').select('*').eq('id', String(order.outlet_id)).maybeSingle();
      outlet = data;
    }

    const check = checkPinCorrection({ order, driverName: staff.name, lat: body.lat, lon: body.lon, accuracyM: body.accuracy, outlet });
    if (!check.ok) return deny(check.status, check.error);
    const { point, accuracyM } = check;
    const before = toLatLon(order!.latitude, order!.longitude);

    const { error: updErr } = await db.from('pickup_orders').update({ latitude: point.lat, longitude: point.lon }).eq('id', orderId);
    if (updErr) throw new Error(`${updErr.code ?? ''} ${updErr.message}`.trim());

    // The customer's saved address (only when it belongs to the same customer).
    let addressUpdated = false;
    const addressId = String(order!.address_id || '');
    if (UUID.test(addressId)) {
      const { data: addr } = await db.from('customer_addresses').select('id, customer_phone').eq('id', addressId).maybeSingle();
      if (addr && samePhone(addr.customer_phone, order!.customer_phone)) {
        const { error } = await db.from('customer_addresses').update({ latitude: point.lat, longitude: point.lon }).eq('id', addressId);
        if (error) {
          await insertErrorLog({ source: 'pickup_pin', code: 'ADDRESS_PIN_UPDATE_FAILED', message: `${error.code ?? ''} ${error.message}`.slice(0, 300) });
        } else {
          addressUpdated = true;
        }
      }
    }

    const movedM = before ? Math.round(distanceM(before, point)) : null;
    await insertAuditLog({
      user_id: String(staff.id),
      user_name: String(staff.name || ''),
      role: String(staff.role || ''),
      action: 'pickup_pin_corrected',
      entity_type: 'pickup_orders',
      entity_id: orderId,
      meta: {
        order_number: order!.order_number,
        from: before,
        to: point,
        moved_m: movedM,
        accuracy_m: Math.round(accuracyM),
        address_id: addressUpdated ? addressId : null
      },
      ip_address: clientIp(req)
    });

    return NextResponse.json({ ok: true, latitude: point.lat, longitude: point.lon, moved_m: movedM, addressUpdated }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'pickup_pin', code: 'PICKUP_PIN_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Titik belum tersimpan. Coba lagi sebentar lagi.');
  }
}
