/**
 * Server-side validation of an online customer order (pickup_orders) before
 * /api/customer/order/create writes it with the service role.
 *
 * The browser only sends what the customer chose; the server decides:
 * - phone: the verified session phone when there is a session (the body
 *   cannot order in someone else's name); legacy login only while it is on;
 * - status / pickup_date: computed here (Jakarta date), not trusted;
 * - items: only known fields, bounded sizes; photo_path only when the photo
 *   feature is on, and then EVERY satuan piece must carry a photo from the
 *   customer's own server-issued folder (existence is checked by the route);
 * - no field outside the whitelist reaches the table.
 * Prices stay estimates (the cashier bills after weighing), as before.
 */
import { isValidCustomerPhone, storedPhone } from '@/lib/phone';
import { isValidSatuanPhotoPath } from '@/lib/satuanPhotoAccess';

export type CustomerOrderContext = {
  /** Verified session phone (08…) or null. */
  sessionPhone: string | null;
  /** Legacy (unverified) login still enabled. */
  legacyAllowed: boolean;
  /** Satuan photo feature on (then photos are mandatory). */
  photoRequired: boolean;
  /** Owner folder of the session customer (satuanPhotoOwnerFolder), '' without session. */
  ownerFolder: string;
  /** Jakarta date YYYY-MM-DD. */
  today: string;
};

export type ValidOrder = { row: Record<string, unknown>; photoPaths: string[]; scheduled: boolean };
export type OrderCheck = { ok: true; order: ValidOrder } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NO = /^ORD-\d{8}-\d{4}$/;
const MAX_ITEMS = 40;
const MAX_PIECES = 50;
const MAX_SCHEDULE_DAYS = 60;
/** Values the app uses (customer form, CS, driver portal). */
const COURIER_TYPES = new Set(['INTERNAL', 'THIRD_PARTY', 'INSTANT']);

const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const num = (v: unknown, min: number, max: number, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));

/**
 * Stored customer phone (lib/phone): 08… for Indonesian mobiles, +<cc>… for
 * foreign numbers; '' when not a valid WhatsApp number.
 */
export const orderPhone08 = (raw: unknown): string => (isValidCustomerPhone(raw) ? storedPhone(raw) : '');

/** Jakarta calendar date (UTC+7, no DST). */
export const jakartaDate = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

const cleanCounts = (v: unknown): Record<string, number> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
    const key = str(k, 40);
    if (key) out[key] = int(n, 0, 500, 0);
  }
  return out;
};

type PieceIn = { merk?: unknown; warna?: unknown; corak?: unknown; photo_path?: unknown };

export function validateCustomerOrder(body: Record<string, unknown>, ctx: CustomerOrderContext): OrderCheck {
  const fail = (status: number, error: string): OrderCheck => ({ ok: false, status, error });

  // Who orders.
  const bodyPhone = orderPhone08(body.customer_phone ?? body.phone_number);
  let phone: string;
  if (ctx.sessionPhone) {
    phone = orderPhone08(ctx.sessionPhone);
    if (bodyPhone && bodyPhone !== phone) return fail(403, 'Nomor pesanan tidak sama dengan akun yang masuk.');
  } else {
    if (!ctx.legacyAllowed) return fail(401, 'Masuk lewat WhatsApp/email terlebih dahulu.');
    phone = bodyPhone;
  }
  if (!phone) return fail(400, 'Nomor WhatsApp tidak valid.');

  const outletId = str(body.outlet_id, 64);
  if (!UUID.test(outletId)) return fail(400, 'Pilih outlet terlebih dahulu.');
  const address = str(body.address, 500);
  if (!address) return fail(400, 'Alamat penjemputan wajib diisi.');

  // Items.
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return fail(400, 'Pilih minimal satu layanan.');
  if (rawItems.length > MAX_ITEMS) return fail(400, 'Terlalu banyak item dalam satu pesanan.');
  const photoPaths: string[] = [];
  let pieceCount = 0;
  const items: Record<string, unknown>[] = [];
  for (const it of rawItems as Record<string, unknown>[]) {
    if (!it || typeof it !== 'object') return fail(400, 'Item pesanan tidak valid.');
    const name = str(it.name, 120);
    if (!name) return fail(400, 'Item pesanan tanpa nama layanan.');
    const base = {
      name,
      qty: int(it.qty, 1, 50, 1),
      price: num(it.price, 0, 100_000_000),
      duration: str(it.duration, 60) || 'Reguler (3 Hari)'
    };
    if (it.type === 'kg') {
      items.push({ ...base, weight: num(it.weight, 0, 200), type: 'kg', bag_category_counts: cleanCounts(it.bag_category_counts) });
      continue;
    }
    if (it.type !== 'pcs') return fail(400, 'Jenis item pesanan tidak dikenal.');
    const piecesIn = Array.isArray(it.pieces) ? (it.pieces as PieceIn[]) : [];
    pieceCount += piecesIn.length;
    if (pieceCount > MAX_PIECES) return fail(400, 'Terlalu banyak potong dalam satu pesanan.');
    const pieces = piecesIn.map((p) => {
      const piece: Record<string, string> = { merk: str(p?.merk, 60), warna: str(p?.warna, 60), corak: str(p?.corak, 60) };
      if (ctx.photoRequired) {
        const path = p?.photo_path;
        if (!isValidSatuanPhotoPath(path) || !ctx.ownerFolder || !path.startsWith(`${ctx.ownerFolder}/`)) return null;
        piece.photo_path = path;
        photoPaths.push(path);
      }
      return piece;
    });
    if (ctx.photoRequired) {
      if (!ctx.sessionPhone) return fail(401, 'Masuk lewat WhatsApp/email untuk memesan item satuan dengan foto.');
      if (!pieces.length || pieces.length !== base.qty || pieces.some((p) => p === null)) {
        return fail(400, `Setiap potong "${name}" wajib punya foto yang diunggah dari akun ini.`);
      }
    }
    items.push({ ...base, basePrice: num(it.basePrice, 0, 100_000_000), type: 'pcs', pieces, notes: str(it.notes, 500) });
  }

  // When: the server decides the status and the date.
  const rawDate = str(body.pickup_date, 10);
  const rawTime = str(body.pickup_time, 8);
  const scheduled = Boolean(rawTime) && /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  let pickupDate = ctx.today;
  let pickupTime: string | null = null;
  let scheduledAt: string | null = null;
  if (scheduled) {
    if (rawDate < ctx.today || rawDate > addDays(ctx.today, MAX_SCHEDULE_DAYS)) return fail(400, 'Tanggal jemput di luar rentang yang diizinkan.');
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawTime)) return fail(400, 'Jam jemput tidak valid.');
    pickupDate = rawDate;
    pickupTime = rawTime.length === 5 ? `${rawTime}:00` : rawTime;
    const at = Date.parse(`${rawDate}T${pickupTime}+07:00`);
    if (!Number.isFinite(at)) return fail(400, 'Jadwal jemput tidak valid.');
    scheduledAt = new Date(at).toISOString();
  }

  const lat = body.latitude == null || body.latitude === '' ? null : num(body.latitude, -90, 90, NaN);
  const lon = body.longitude == null || body.longitude === '' ? null : num(body.longitude, -180, 180, NaN);
  const courier = str(body.courier_type, 20).toUpperCase();
  const orderNumber = str(body.order_number, 32);

  const row: Record<string, unknown> = {
    order_number: ORDER_NO.test(orderNumber) ? orderNumber : undefined,
    outlet_id: outletId,
    customer_name: str(body.customer_name, 80) || 'Pelanggan Online',
    customer_phone: phone,
    phone_number: phone,
    service_type: str(body.service_type, 120) || 'Pickup',
    estimated_weight: num(body.estimated_weight, 0, 200),
    address,
    formatted_address: address,
    latitude: Number.isFinite(lat as number) ? lat : null,
    longitude: Number.isFinite(lon as number) ? lon : null,
    address_id: UUID.test(str(body.address_id, 64)) ? str(body.address_id, 64) : null,
    duration: str(body.duration, 60) || 'Reguler (3 Hari)',
    bag_count: int(body.bag_count, 1, 20, 1),
    wash_process: str(body.wash_process, 40),
    has_fading: body.has_fading === true,
    has_valuables: false,
    items,
    delivery_fee: num(body.delivery_fee, 0, 1_000_000),
    notes: str(body.notes, 2000) || null,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    scheduled_at: scheduledAt,
    pickup_at: scheduledAt,
    status: scheduled ? 'Terjadwal' : 'Menunggu Kurir',
    courier_type: scheduled ? null : COURIER_TYPES.has(courier) ? courier : 'INTERNAL'
  };
  // Identical pieces may share one photo ("semua potong sama" in the form).
  return { ok: true, order: { row, photoPaths: [...new Set(photoPaths)], scheduled } };
}
