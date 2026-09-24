import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertAuditLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import {
  isValidSatuanPhotoPath,
  photoBelongsToOrder,
  SATUAN_PHOTO_VIEW_TTL_SEC,
  staffMayViewOrderPhoto
} from '@/lib/satuanPhotoAccess';
import { SATUAN_ITEM_PHOTO_BUCKET, satuanPhotoConfig } from '@/lib/satuanPhotoServer';
import { readStaffSession } from '@/lib/staffAuth/server';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * URL bertanda tangan (5 menit) untuk satu foto item satuan pada satu pesanan.
 * Syarat: cookie sesi staf valid, peran & outlet staf dicek ulang dari DB,
 * dan foto memang milik pesanan tersebut. Setiap akses dicatat di audit_logs.
 */
export async function POST(req: NextRequest) {
  const cfg = satuanPhotoConfig();
  if (!cfg.enabled) return deny(503, 'Fitur foto item satuan belum aktif.');
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  const session = readStaffSession(req);
  if (!session) return deny(401, 'Sesi staf belum terverifikasi. Keluar lalu login ulang.');

  const body = await req.json().catch(() => ({}));
  const pickupOrderId = String(body?.pickupOrderId || '').trim();
  const path = body?.path;
  if (!pickupOrderId || pickupOrderId.length > 64 || !isValidSatuanPhotoPath(path)) {
    return deny(400, 'Permintaan foto tidak valid.');
  }

  try {
    const db = paymentServiceDb();
    const { data: staff, error: staffErr } = await db
      .from('employees')
      .select('id, name, role, outlet_id, access_outlets, assigned_outlet_ids')
      .eq('id', session.sid)
      .maybeSingle();
    if (staffErr || !staff) return deny(401, 'Akun staf tidak ditemukan. Login ulang.');

    const { data: order, error: orderErr } = await db
      .from('pickup_orders')
      .select('id, outlet_id, customer_phone, items')
      .eq('id', pickupOrderId)
      .maybeSingle();
    if (orderErr || !order) return deny(404, 'Pesanan tidak ditemukan.');

    if (!staffMayViewOrderPhoto(staff, order)) return deny(403, 'Anda tidak berwenang melihat foto pesanan ini.');
    if (!photoBelongsToOrder(path, order, cfg.ownerSecret)) return deny(404, 'Foto tidak ditemukan pada pesanan ini.');

    const { data, error } = await db.storage
      .from(SATUAN_ITEM_PHOTO_BUCKET)
      .createSignedUrl(path, SATUAN_PHOTO_VIEW_TTL_SEC);
    if (error || !data?.signedUrl) return deny(502, 'Gagal memuat foto.');

    await insertAuditLog({
      user_id: String(staff.id),
      user_name: String(staff.name || ''),
      role: String(staff.role || ''),
      action: 'view_satuan_item_photo',
      entity_type: 'pickup_orders',
      entity_id: String(order.id),
      meta: { path },
      ip_address: clientIp(req)
    });

    return NextResponse.json({ url: data.signedUrl, expiresIn: SATUAN_PHOTO_VIEW_TTL_SEC }, { headers: noStore });
  } catch {
    return deny(502, 'Gagal memuat foto.');
  }
}
