import { NextResponse, type NextRequest } from 'next/server';
import { customerAuthConfig, readSession } from '@/lib/customerAuth/server';
import { jakartaDate, validateCustomerOrder } from '@/lib/customerOrderServer';
import { clientIp, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { newOrderNumber, pickupOrderAttempts, pickupRoleTaskAttempts } from '@/lib/pickupOrderRows';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { satuanPhotoOwnerFolder } from '@/lib/satuanPhotoAccess';
import { checkPickupServiceArea } from '@/lib/serviceArea';
import { SATUAN_ITEM_PHOTO_BUCKET, satuanPhotoConfig } from '@/lib/satuanPhotoServer';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
const perIp = createMemoryRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

type Db = ReturnType<typeof paymentServiceDb>;

/** First payload variant the live schema accepts (same order as the browser path). */
async function insertFirst(db: Db, table: string, attempts: Record<string, unknown>[]) {
  let last = '';
  for (const row of attempts) {
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const { data, error } = await db.from(table).insert([clean]).select('id');
    if (!error) return { id: String(data?.[0]?.id ?? ''), error: null };
    last = `${error.code ?? ''} ${error.message}`.trim();
  }
  return { id: '', error: last || `insert ${table} failed` };
}

/** Does every photo exist in the private bucket (uploaded through a server-issued token)? */
async function photosExist(db: Db, paths: string[]) {
  const bucket = db.storage.from(SATUAN_ITEM_PHOTO_BUCKET);
  for (const path of paths) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const file = path.slice(path.lastIndexOf('/') + 1);
    const { data, error } = await bucket.list(dir, { search: file, limit: 2 });
    if (error || !(data || []).some((o) => o.name === file)) return false;
  }
  return true;
}

/**
 * Online customer order (pickup_orders + driver/CS tasks), created by the
 * SERVER. The customer app no longer writes pickup_orders itself: the body is
 * validated (lib/customerOrderServer), the phone comes from the verified
 * session, status/dates are computed here, and — while the satuan photo
 * feature is on — every satuan piece must carry a photo that exists in the
 * customer's own private folder. Idempotent per order_number.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return deny(413, 'Pesanan terlalu besar.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu banyak pesanan. Coba lagi beberapa menit lagi.');

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return deny(413, 'Pesanan terlalu besar.');
    body = JSON.parse(text || '{}');
  } catch {
    return deny(400, 'Data pesanan tidak valid.');
  }

  const session = readSession(req);
  const photo = satuanPhotoConfig();
  const check = validateCustomerOrder(body, {
    sessionPhone: session?.phone ?? null,
    legacyAllowed: customerAuthConfig().legacy,
    photoRequired: photo.enabled,
    ownerFolder: session && photo.enabled ? satuanPhotoOwnerFolder(session.phone, photo.ownerSecret) : '',
    today: jakartaDate()
  });
  if (!check.ok) return deny(check.status, check.error);
  const { row, photoPaths, scheduled } = check.order;

  try {
    const db = paymentServiceDb();
    const outlet = await db.from('outlets').select('*').eq('id', String(row.outlet_id)).maybeSingle();
    if (outlet.error || !outlet.data) return deny(400, 'Outlet tidak ditemukan.');
    // Outlet buka (tidak penuh / coming soon) dan pin dalam jangkauan layanan.
    const area = checkPickupServiceArea(row, outlet.data);
    if (!area.ok) return deny(area.status, area.error);
    if (photoPaths.length && !(await photosExist(db, photoPaths))) {
      return deny(400, 'Foto item satuan belum terunggah. Unggah ulang fotonya lalu pesan lagi.');
    }

    // Idempotent: the form reuses its order number on retry / repeated taps.
    const orderNumber = String(row.order_number || newOrderNumber());
    const existing = await db.from('pickup_orders').select('id, customer_phone, status').eq('order_number', orderNumber).limit(1);
    if (existing.error) throw new Error(`${existing.error.code ?? ''} ${existing.error.message}`);
    const prior = existing.data?.[0];
    if (prior) {
      if (String(prior.customer_phone) !== String(row.customer_phone)) return deny(409, 'Nomor pesanan sudah dipakai.');
      return NextResponse.json({ id: String(prior.id), order_number: orderNumber, status: prior.status, duplicate: true }, { headers: noStore });
    }

    const payload = { ...row, order_number: orderNumber };
    const created = await insertFirst(db, 'pickup_orders', pickupOrderAttempts(payload, String(row.pickup_date)));
    if (created.error || !created.id) throw new Error(created.error || 'no id');

    if (!scheduled) {
      const due = new Date(Date.now() + 2 * 3600_000);
      const order = { id: created.id, customer_name: String(row.customer_name), customer_phone: String(row.customer_phone) };
      for (const role of ['driver', 'cs'] as const) {
        const task = await insertFirst(db, 'system_tasks', pickupRoleTaskAttempts(order, role, due));
        if (task.error) await insertErrorLog({ source: 'customer_order_create', code: 'TASK_CREATE_FAILED', message: `${role}: ${task.error}` });
      }
    }

    return NextResponse.json(
      {
        id: created.id,
        order_number: orderNumber,
        status: row.status,
        pickup_date: row.pickup_date,
        pickup_time: row.pickup_time,
        scheduled_at: row.scheduled_at
      },
      { headers: noStore }
    );
  } catch (e) {
    // Postgres puts the whole row into "Failing row contains (…)": strip it, so no
    // name/phone/address reaches error_logs or the response.
    const message = String((e as Error)?.message || e)
      .replace(/Failing row contains \([\s\S]*\)\.?/gi, '')
      .slice(0, 300);
    await insertErrorLog({ source: 'customer_order_create', code: 'ORDER_CREATE_FAILED', message });
    return NextResponse.json({ error: 'Pesanan belum tersimpan. Coba lagi sebentar lagi.', detail: message }, { status: 500, headers: noStore });
  }
}
