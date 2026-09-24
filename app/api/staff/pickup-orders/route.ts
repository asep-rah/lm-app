import { NextResponse, type NextRequest } from 'next/server';
import { jakartaDate, orderPhone08 } from '@/lib/customerOrderServer';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { newOrderNumber, pickupOrderAttempts } from '@/lib/pickupOrderRows';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { readStaffSession } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/** Staff roles that already take customer orders (CS, cashier, admin ops, management). */
const STAFF_ORDER_ROLES = new Set(['admin', 'admin_ops', 'owner', 'supervisor', 'cs', 'cs_care', 'head_cs', 'kasir', 'cashier']);

/**
 * Pickup order entered by STAFF (the /admin "Order Laundry Online" form).
 * Requires the signed staff session; the role is re-read from employees.
 * The row uses the same columns and status as customer orders
 * ("Menunggu Kurir") so it appears in the pickup / POS / driver lists.
 * Audited in audit_logs.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const session = readStaffSession(req);
  if (!session) return deny(401, 'Masuk sebagai staf terlebih dahulu.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const customerName = str(body.customer_name, 80);
  const phone = orderPhone08(body.customer_phone);
  const address = str(body.address, 500);
  if (!customerName || !phone || !address) return deny(400, 'Nama, nomor WhatsApp, dan alamat wajib diisi.');
  const outletId = str(body.outlet_id, 64);
  if (outletId && !UUID.test(outletId)) return deny(400, 'Outlet tidak valid.');

  try {
    const db = paymentServiceDb();
    const { data: staff } = await db.from('employees').select('id, name, role').eq('id', session.sid).maybeSingle();
    if (!staff) return deny(401, 'Akun staf tidak ditemukan. Login ulang.');
    if (!STAFF_ORDER_ROLES.has(String(staff.role || '').toLowerCase())) return deny(403, 'Peran Anda tidak boleh membuat pesanan jemput.');
    if (outletId) {
      const outlet = await db.from('outlets').select('id').eq('id', outletId).maybeSingle();
      if (!outlet.data) return deny(400, 'Outlet tidak ditemukan.');
    }

    const today = jakartaDate();
    const orderNumber = newOrderNumber();
    let id = '';
    let last = '';
    for (const row of pickupOrderAttempts(
      {
        order_number: orderNumber,
        outlet_id: outletId || null,
        customer_name: customerName,
        customer_phone: phone,
        phone_number: phone,
        service_type: str(body.service_type, 200) || 'Pickup',
        address,
        notes: str(body.notes, 2000) || null,
        status: 'Menunggu Kurir',
        pickup_date: today
      },
      today
    )) {
      const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
      const { data, error } = await db.from('pickup_orders').insert([clean]).select('id');
      if (!error) {
        id = String(data?.[0]?.id ?? '');
        break;
      }
      last = error.message;
    }
    if (!id) throw new Error(last || 'insert failed');
    await insertAuditLog({
      user_id: String(staff.id),
      user_name: String(staff.name || ''),
      role: String(staff.role || ''),
      action: 'staff_create_pickup_order',
      entity_type: 'pickup_orders',
      entity_id: id,
      ip_address: clientIp(req)
    });
    return NextResponse.json({ id, order_number: orderNumber }, { headers: noStore });
  } catch (e) {
    const message = String((e as Error)?.message || e).replace(/Failing row contains \([\s\S]*\)\.?/gi, '').slice(0, 300);
    await insertErrorLog({ source: 'staff_pickup_order', code: 'STAFF_ORDER_FAILED', message });
    return deny(500, 'Pesanan belum tersimpan. Coba lagi sebentar lagi.');
  }
}
