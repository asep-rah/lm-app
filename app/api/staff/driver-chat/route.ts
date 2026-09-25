import { NextResponse, type NextRequest } from 'next/server';
import { cleanDriverChatText, isDriverChatOpen, sameDriverName } from '@/lib/driverChat';
import {
  insertChatMessage,
  isOrderId,
  listChatMessages,
  loadChatOrder,
  markChatRead,
  openStatuses,
  unreadCounts
} from '@/lib/driverChatServer';
import { clientIp, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { readStaffSession } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 120, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

type Db = ReturnType<typeof paymentServiceDb>;

/**
 * Driver side of the order chat. Signed staff session; the role and name are
 * re-read from employees. A driver only reaches orders assigned to them
 * (pickup_orders.driver_name).
 */
async function currentDriver(req: NextRequest, db: Db) {
  const session = readStaffSession(req);
  if (!session) return { error: deny(401, 'Sesi driver berakhir. Keluar lalu masuk lagi.') };
  const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
  if (!staff) return { error: deny(401, 'Akun tidak ditemukan. Masuk lagi.') };
  if (String(staff.role || '').toLowerCase() !== 'driver') return { error: deny(403, 'Chat pelanggan hanya untuk driver.') };
  return { name: String(staff.name || '').trim() };
}

const failed = async (e: unknown, code: string) => {
  await insertErrorLog({ source: 'driver_chat_staff', code, message: String((e as Error)?.message || e).slice(0, 300) });
  return deny(500, 'Chat belum bisa dimuat. Coba lagi sebentar lagi.');
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const db = paymentServiceDb();
    const me = await currentDriver(req, db);
    if ('error' in me) return me.error;

    if (q.get('unread')) {
      const { data, error } = await db
        .from('pickup_orders')
        .select('id, driver_name, status')
        .in('status', openStatuses())
        .eq('driver_name', me.name)
        .limit(50);
      if (error) throw new Error(error.message);
      const ids = (data || []).filter((o) => isDriverChatOpen(o)).map((o) => String(o.id));
      return NextResponse.json({ counts: await unreadCounts(db, ids, 'customer') }, { headers: noStore });
    }

    const id = q.get('order');
    if (!isOrderId(id)) return deny(400, 'Pesanan tidak valid.');
    const order = await loadChatOrder(db, id);
    if (!order || !sameDriverName(order.driver_name, me.name)) return deny(404, 'Pesanan ini bukan tugas Anda.');
    const messages = await listChatMessages(db, id);
    await markChatRead(db, id, 'driver');
    return NextResponse.json(
      { open: isDriverChatOpen(order), customerName: order.customer_name, orderNumber: order.order_number, status: order.status, messages },
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
  const message = cleanDriverChatText(body.message);
  if (!message) return deny(400, 'Pesan kosong.');
  const id = body.order;
  if (!isOrderId(id)) return deny(400, 'Pesanan tidak valid.');
  try {
    const db = paymentServiceDb();
    const me = await currentDriver(req, db);
    if ('error' in me) return me.error;
    const order = await loadChatOrder(db, id);
    if (!order || !sameDriverName(order.driver_name, me.name)) return deny(404, 'Pesanan ini bukan tugas Anda.');
    if (!isDriverChatOpen(order)) return deny(409, 'Chat hanya bisa selama Anda menjemput atau mengantar pesanan ini.');
    const saved = await insertChatMessage(db, { orderId: id, sender: 'driver', senderName: me.name.slice(0, 80), message });
    return NextResponse.json({ message: saved }, { headers: noStore });
  } catch (e) {
    return failed(e, 'DRIVER_CHAT_SEND_FAILED');
  }
}
