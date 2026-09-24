import { NextResponse, type NextRequest } from 'next/server';
import { customerAuthConfig, readSession } from '@/lib/customerAuth/server';
import { orderPhone08 } from '@/lib/customerOrderServer';
import { cleanDriverChatText, driverNameOf, isDriverChatOpen } from '@/lib/driverChat';
import {
  insertChatMessage,
  isOrderId,
  listChatMessages,
  loadChatOrder,
  markChatRead,
  openStatuses,
  orderBelongsTo,
  unreadCounts
} from '@/lib/driverChatServer';
import { clientIp, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 60, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * Customer side of the driver chat. The customer is the verified session
 * phone; with legacy login still enabled, the phone the app sends (same rule
 * as order creation / delivery request). Only orders of that phone.
 */
function customerPhone(req: NextRequest, sent: unknown): { phone: string } | { error: NextResponse } {
  const session = readSession(req);
  const typed = orderPhone08(sent);
  if (session) {
    const phone = orderPhone08(session.phone);
    if (typed && typed !== phone) return { error: deny(403, 'Nomor tidak sama dengan akun yang masuk.') };
    return { phone };
  }
  if (!customerAuthConfig().legacy) return { error: deny(401, 'Masuk lewat WhatsApp/email terlebih dahulu.') };
  if (!typed) return { error: deny(401, 'Masuk terlebih dahulu.') };
  return { phone: typed };
}

const failed = async (e: unknown, code: string) => {
  await insertErrorLog({ source: 'driver_chat_customer', code, message: String((e as Error)?.message || e).slice(0, 300) });
  return deny(500, 'Chat belum bisa dimuat. Coba lagi sebentar lagi.');
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  // Legacy login only: the phone travels in a header, not in the URL (no logs).
  const who = customerPhone(req, req.headers.get('x-customer-phone'));
  if ('error' in who) return who.error;
  try {
    const db = paymentServiceDb();

    // Badge: unread driver messages on the customer's running trips.
    if (q.get('unread')) {
      const variants = [who.phone, `62${who.phone.slice(1)}`, `+62${who.phone.slice(1)}`];
      const list = variants.map((v) => `"${v}"`).join(',');
      const { data, error } = await db
        .from('pickup_orders')
        .select('id, customer_phone, phone_number, driver_name, status')
        .in('status', openStatuses())
        .or(`customer_phone.in.(${list}),phone_number.in.(${list})`)
        .limit(20);
      if (error) throw new Error(error.message);
      const ids = (data || []).filter((o) => isDriverChatOpen(o)).map((o) => String(o.id));
      return NextResponse.json({ counts: await unreadCounts(db, ids, 'driver') }, { headers: noStore });
    }

    const id = q.get('order');
    if (!isOrderId(id)) return deny(400, 'Pesanan tidak valid.');
    const order = await loadChatOrder(db, id);
    if (!order || !orderBelongsTo(order, who.phone)) return deny(404, 'Pesanan tidak ditemukan.');
    const messages = await listChatMessages(db, id);
    await markChatRead(db, id, 'customer');
    return NextResponse.json(
      { open: isDriverChatOpen(order), driverName: driverNameOf(order), orderNumber: order.order_number, status: order.status, messages },
      { headers: noStore }
    );
  } catch (e) {
    return failed(e, 'DRIVER_CHAT_LOAD_FAILED');
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu banyak pesan. Coba lagi beberapa menit lagi.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = customerPhone(req, body.phone);
  if ('error' in who) return who.error;
  const message = cleanDriverChatText(body.message);
  if (!message) return deny(400, 'Pesan kosong.');
  const id = body.order;
  if (!isOrderId(id)) return deny(400, 'Pesanan tidak valid.');
  try {
    const db = paymentServiceDb();
    const order = await loadChatOrder(db, id);
    if (!order || !orderBelongsTo(order, who.phone)) return deny(404, 'Pesanan tidak ditemukan.');
    if (!isDriverChatOpen(order)) return deny(409, 'Chat dengan driver hanya bisa selama driver menjemput atau mengantar.');
    const saved = await insertChatMessage(db, {
      orderId: id,
      sender: 'customer',
      senderName: String(order.customer_name || '').slice(0, 80),
      message
    });
    return NextResponse.json({ message: saved }, { headers: noStore });
  } catch (e) {
    return failed(e, 'DRIVER_CHAT_SEND_FAILED');
  }
}
