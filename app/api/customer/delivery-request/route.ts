import { NextResponse, type NextRequest } from 'next/server';
import { customerAuthConfig, readSession } from '@/lib/customerAuth/server';
import { jakartaDate, orderPhone08 } from '@/lib/customerOrderServer';
import { requestDeliveryServer } from '@/lib/deliveryRequestServer';
import { clientIp, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * "Minta diantar" from the customer app, done by the server
 * (lib/deliveryRequestServer): only for an order of the verified session phone
 * (legacy login: the phone typed at login, while legacy login is enabled).
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const session = readSession(req);
  const bodyPhone = orderPhone08(body.customerPhone);
  let phone: string;
  if (session) {
    phone = orderPhone08(session.phone);
    if (bodyPhone && bodyPhone !== phone) return deny(403, 'Nomor tidak sama dengan akun yang masuk.');
  } else {
    if (!customerAuthConfig().legacy) return deny(401, 'Masuk lewat WhatsApp/email terlebih dahulu.');
    phone = bodyPhone;
  }

  try {
    const out = await requestDeliveryServer(paymentServiceDb(), {
      kind: body.kind === 'transaction' ? 'transaction' : 'pickup',
      orderId: String(body.orderId || ''),
      phone,
      customerName: String(body.customerName || ''),
      address: String(body.address || ''),
      outletId: body.outletId ? String(body.outletId) : null,
      today: jakartaDate()
    });
    if (!out.ok) return deny(out.status, out.error);
    return NextResponse.json({ pickupId: out.pickupId, already: out.already }, { headers: noStore });
  } catch (e) {
    const message = String((e as Error)?.message || e).replace(/Failing row contains \([\s\S]*\)\.?/gi, '').slice(0, 300);
    await insertErrorLog({ source: 'customer_delivery_request', code: 'DELIVERY_REQUEST_FAILED', message });
    return deny(500, 'Permintaan pengantaran belum terkirim. Coba lagi sebentar lagi.');
  }
}
