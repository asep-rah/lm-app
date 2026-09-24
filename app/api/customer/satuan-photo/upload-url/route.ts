import { NextResponse, type NextRequest } from 'next/server';
import { readSession } from '@/lib/customerAuth/server';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import { isSameOriginRequest } from '@/lib/requestGuards';
import { newSatuanPhotoPath, satuanPhotoOwnerFolder, SATUAN_PHOTO_UPLOAD_MAX_PER_HOUR } from '@/lib/satuanPhotoAccess';
import { SATUAN_ITEM_PHOTO_BUCKET, satuanPhotoConfig } from '@/lib/satuanPhotoServer';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Signed upload URL untuk SATU foto item satuan. Path dibuat server di folder
 * milik customer yang sesinya terverifikasi; token hanya berlaku untuk path
 * itu. Bucket tidak punya policy anon, jadi tanpa token ini tidak ada upload.
 */
export async function POST(req: NextRequest) {
  const cfg = satuanPhotoConfig();
  if (!cfg.enabled) {
    return NextResponse.json({ error: 'Fitur foto item satuan belum aktif.' }, { status: 503, headers: noStore });
  }
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ error: 'Permintaan ditolak.' }, { status: 403, headers: noStore });
  }
  const session = readSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Sesi Anda belum terverifikasi. Masuk lewat WhatsApp/email untuk mengunggah foto.' },
      { status: 401, headers: noStore }
    );
  }
  const folder = satuanPhotoOwnerFolder(session.phone, cfg.ownerSecret);
  if (!folder) {
    return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401, headers: noStore });
  }

  try {
    const db = paymentServiceDb();
    const bucket = db.storage.from(SATUAN_ITEM_PHOTO_BUCKET);
    const path = newSatuanPhotoPath(folder);
    const monthFolder = path.split('/').slice(0, 2).join('/');
    const { data: recent, error: listErr } = await bucket.list(monthFolder, {
      limit: SATUAN_PHOTO_UPLOAD_MAX_PER_HOUR + 1,
      sortBy: { column: 'created_at', order: 'desc' }
    });
    if (listErr) throw listErr;
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const lastHour = (recent || []).filter((o) => o.created_at && new Date(o.created_at).getTime() > hourAgo).length;
    if (lastHour >= SATUAN_PHOTO_UPLOAD_MAX_PER_HOUR) {
      return NextResponse.json(
        { error: 'Terlalu banyak foto diunggah dalam satu jam. Coba lagi nanti.' },
        { status: 429, headers: noStore }
      );
    }
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data?.token) throw error || new Error('no token');
    return NextResponse.json({ path: data.path || path, token: data.token }, { headers: noStore });
  } catch {
    return NextResponse.json(
      { error: 'Layanan unggah foto sedang bermasalah. Coba lagi sebentar lagi.' },
      { status: 502, headers: noStore }
    );
  }
}
