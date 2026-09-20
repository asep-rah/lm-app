/**
 * Snapshot rating & review Google Bisnis per outlet dari n8n.
 *
 * Idempoten per outlet per hari lewat indeks unik (outlet_id, snapshot_date):
 * n8n boleh dijalankan ulang di hari yang sama tanpa menumpuk baris.
 *
 * Kolom outlets.google_rating / google_review_count ikut diperbarui supaya
 * halaman publik tetap menampilkan angka terkini; riwayatnya ada di snapshot.
 */
import { NextResponse } from 'next/server';
import { n8nAuthorized, unauthorized } from '@/lib/n8nAuth';
import { paymentServiceDb } from '@/lib/paymentSecurity';

export const dynamic = 'force-dynamic';

type SnapshotInput = {
  outlet_id?: string;
  rating?: number | string;
  review_count?: number | string;
  unreplied_count?: number | string;
  new_reviews?: unknown[];
  snapshot_date?: string;
};

const normalize = (input: SnapshotInput) => {
  const outletId = String(input?.outlet_id || '').trim();
  if (!outletId) return { row: null, error: 'outlet_id wajib diisi' };

  const rating = input?.rating == null ? null : Number(input.rating);
  if (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
    return { row: null, error: `rating di luar rentang 0-5: ${String(input.rating)}` };
  }

  const date = String(input?.snapshot_date || '').trim();
  const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10);

  return {
    error: null,
    row: {
      outlet_id: outletId,
      rating,
      review_count: input?.review_count == null ? null : Number(input.review_count) || 0,
      unreplied_count: Number(input?.unreplied_count) || 0,
      new_reviews: Array.isArray(input?.new_reviews) ? input.new_reviews : [],
      snapshot_date: snapshotDate,
      captured_at: new Date().toISOString(),
      source: 'n8n'
    }
  };
};

export async function POST(req: Request) {
  if (!n8nAuthorized(req)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const raw = (body as { snapshots?: unknown })?.snapshots ?? body;
  const inputs = (Array.isArray(raw) ? raw : [raw]) as SnapshotInput[];
  if (!inputs.length) return NextResponse.json({ error: 'snapshots kosong' }, { status: 400 });

  const rejected: { index: number; error: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  inputs.forEach((input, index) => {
    const res = normalize(input);
    if (res.row) rows.push(res.row);
    else rejected.push({ index, error: String(res.error) });
  });

  if (!rows.length) return NextResponse.json({ ok: true, upserted: 0, rejected });

  const db = paymentServiceDb();
  const { error } = await db
    .from('outlet_google_snapshots')
    .upsert(rows, { onConflict: 'outlet_id,snapshot_date' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Nilai terkini per outlet. Kegagalan di sini tidak membatalkan snapshot yang
  // sudah tersimpan -- riwayat lebih penting daripada kolom ringkasan.
  let outletsUpdated = 0;
  for (const row of rows) {
    const { error: updErr } = await db
      .from('outlets')
      .update({ google_rating: row.rating, google_review_count: row.review_count })
      .eq('id', row.outlet_id);
    if (updErr) console.warn('[n8n] gagal memperbarui outlets:', updErr.message);
    else outletsUpdated += 1;
  }

  return NextResponse.json({ ok: true, upserted: rows.length, outletsUpdated, rejected });
}
