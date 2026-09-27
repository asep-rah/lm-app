import { NextResponse, type NextRequest } from 'next/server';
import { lockedPeriodFor } from '@/lib/financeServer';
import { posMemberPackageOf } from '@/lib/memberPackages';
import { isUuidString } from '@/lib/outletUuid';
import { clientIp, insertAuditLog, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { phoneLookupKeys } from '@/lib/phone';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';
import { insertWithFallbackOn } from '@/lib/safeWrite';
import { requireStaff } from '@/lib/staffAuth/owner';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 30, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * Catatan penjualan paket member di POS (membership_logs = omset top up +
 * komisi kasir). Ditulis server: harga, saldo, dan komisi diambil dari paket
 * (lib/memberPackages), pemilik komisi = staf yang mendaftarkan pelanggan (atau
 * staf yang login), processed_by = staf yang login. Browser tidak lagi bisa
 * menulis membership_logs (omset / komisi palsu).
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu sering. Coba lagi sebentar lagi.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const outletId = String(body.outletId || '').trim();
  const phone = String(body.phone || '').trim();
  const pkg = posMemberPackageOf(body.package);
  const orderType = body.orderType === 'Online' ? 'Online' : 'Offline';
  if (!isUuidString(outletId)) return deny(400, 'Outlet tidak valid. Pilih cabang ulang.');
  if (!/^\+?\d{8,16}$/.test(phone)) return deny(400, 'Nomor pelanggan tidak valid.');
  if (!pkg) return deny(400, 'Paket member tidak dikenal.');

  try {
    const db = paymentServiceDb();
    const me = await requireStaff(req, db);
    if ('error' in me) return me.error;
    const { data: outlet } = await db.from('outlets').select('id').eq('id', outletId).maybeSingle();
    if (!outlet) return deny(400, 'Outlet tidak ditemukan.');
    const lock = await lockedPeriodFor(db, outletId);
    if (lock) return deny(409, `Periode sudah ditutup buku (s.d. ${lock}). Hubungi owner.`);

    const { data: cust } = await db.from('customers').select('registered_by').in('phone', phoneLookupKeys(phone)).limit(1);
    const staffName = me.staff.name || me.staff.id;
    const commissionOwner = String(cust?.[0]?.registered_by || '').trim() || staffName;
    const row = {
      outlet_id: outletId,
      processed_by: staffName,
      commission_owner: commissionOwner,
      customer_phone: phone,
      package_name: pkg.name,
      price: pkg.price,
      balance_added: pkg.balanceAdded,
      commission: pkg.commission,
      order_type: orderType
    };
    const { data, error } = await insertWithFallbackOn<{ id: string }>(db, 'membership_logs', [row], { select: 'id' });
    if (error) throw new Error(error.message);
    const id = data?.[0]?.id || null;
    await insertAuditLog({
      user_id: me.staff.id,
      user_name: me.staff.name,
      role: me.staff.role,
      action: 'membership_sold',
      entity_type: 'membership_logs',
      entity_id: id,
      amount: pkg.price,
      meta: { outlet_id: outletId, package: pkg.name, commission_owner: commissionOwner, order_type: orderType },
      ip_address: clientIp(req)
    });
    return NextResponse.json({ ok: true, id, price: pkg.price, balanceAdded: pkg.balanceAdded }, { headers: noStore });
  } catch (e) {
    await insertErrorLog({ source: 'membership_log', code: 'MEMBERSHIP_LOG_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Catatan member belum tersimpan. Coba lagi sebentar lagi.');
  }
}
