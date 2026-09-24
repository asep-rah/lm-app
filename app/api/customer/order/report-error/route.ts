import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { normalizeOrderErrorReport } from '@/lib/orderErrorReport';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;
const perIp = createMemoryRateLimiter({ max: 5, windowMs: 10 * 60 * 1000 });
const GLOBAL_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_MAX = 100;

const ok = () => NextResponse.json({ ok: true });

/**
 * Catatan error teknis dari form pesanan customer ke error_logs (Diagnosa
 * Sistem). Hanya menerima kategori, nama kolom, pesan tersanitasi, dan hitungan
 * baris — tidak ada payload pesanan, nama, nomor HP, atau alamat. IP disimpan
 * sebagai hash pendek (untuk menandai penyalahgunaan), bukan IP mentah.
 *
 * Pembatas: same-origin, body ≤ 2 KB, 5 laporan/10 menit per IP per instance,
 * dan maksimal 100 laporan/10 menit secara global (dicek di DB).
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return NextResponse.json({ ok: false }, { status: 403 });
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });

  const ip = clientIp(req) || 'unknown';
  if (!perIp(ip)) return NextResponse.json({ ok: false }, { status: 429 });

  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
    const report = normalizeOrderErrorReport(JSON.parse(text || '{}'));
    if (!report) return NextResponse.json({ ok: false }, { status: 400 });

    const db = paymentServiceDb();
    const since = new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString();
    const { count, error } = await db
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'customer_order_form')
      .gte('created_at', since);
    if (error || (count || 0) >= GLOBAL_MAX) return ok();

    const salt = String(process.env.CUSTOMER_AUTH_SECRET || process.env.CRON_SECRET || '');
    const ipHash = salt ? createHash('sha256').update(`${salt}\u0000${ip}`).digest('hex').slice(0, 16) : null;

    await insertErrorLog({
      source: 'customer_order_form',
      code: `${report.stage}:${report.category}`,
      message: report.message || report.category,
      context: { ...report.context, column: report.column, ipHash },
      hint: 'Gagal membuat pesanan online dari /customer/dashboard.'
    });
  } catch {
    /* best-effort: logging tidak boleh mengganggu customer */
  }
  return ok();
}
