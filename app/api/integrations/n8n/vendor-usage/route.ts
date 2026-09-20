/**
 * Impor pemakaian vendor dari n8n (Lalamove, mCoin Smartlink, dll).
 *
 * Idempoten lewat indeks unik (vendor_key, external_id): kiriman yang sama dua
 * kali tidak menggandakan tagihan. Baris tanpa external_id ditolak — impor
 * otomatis tanpa kunci idempotensi adalah sumber tagihan ganda.
 */
import { NextResponse } from 'next/server';
import { n8nAuthorized, unauthorized } from '@/lib/n8nAuth';
import { paymentServiceDb } from '@/lib/paymentSecurity';
import {
  VENDOR_SOURCE,
  importUsageEntries,
  type UpsertClient,
  type UsageImportInput
} from '@/lib/vendorRecap';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!n8nAuthorized(req)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const raw = (body as { entries?: unknown })?.entries ?? body;
  const entries = (Array.isArray(raw) ? raw : [raw]) as UsageImportInput[];
  if (!entries.length) {
    return NextResponse.json({ error: 'entries kosong' }, { status: 400 });
  }
  if (entries.length > 1000) {
    return NextResponse.json({ error: 'Maksimal 1000 entri per kiriman' }, { status: 413 });
  }

  const res = await importUsageEntries(
    paymentServiceDb() as unknown as UpsertClient,
    entries,
    VENDOR_SOURCE.N8N
  );

  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    received: entries.length,
    inserted: res.inserted,
    // skipped = sudah ada sebelumnya; ini yang diharapkan saat n8n mengulang.
    skipped: res.skipped,
    rejected: res.rejected
  });
}
