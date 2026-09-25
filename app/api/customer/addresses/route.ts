import { NextResponse, type NextRequest } from 'next/server';
import {
  ADDRESS_COLUMNS,
  MAX_ADDRESSES_PER_CUSTOMER,
  isAddressId,
  toSavedAddresses,
  validateAddressDraft
} from '@/lib/customerAddressServer';
import { customerAuthConfig, readSession } from '@/lib/customerAuth/server';
import { orderPhone08 } from '@/lib/customerOrderServer';
import { clientIp, insertErrorLog, paymentServiceDb } from '@/lib/paymentSecurity';
import { phoneLookupKeys } from '@/lib/phone';
import { createMemoryRateLimiter, isSameOriginRequest } from '@/lib/requestGuards';

export const dynamic = 'force-dynamic';

const perIp = createMemoryRateLimiter({ max: 120, windowMs: 10 * 60 * 1000 });
const noStore = { 'Cache-Control': 'no-store' };
const deny = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });
const TABLE = 'customer_addresses';

type Db = ReturnType<typeof paymentServiceDb>;

/**
 * The customer's saved addresses. The browser key can no longer write
 * customer_addresses; this route does, for the verified session phone (with
 * legacy login still enabled: the phone the app sends, as for orders/chat).
 * A customer only ever reads or changes rows of their own phone.
 */
function customerPhone(req: NextRequest, sent: unknown): { phone: string } | { error: NextResponse } {
  const session = readSession(req);
  const typed = orderPhone08(sent);
  if (session) {
    const phone = orderPhone08(session.phone);
    if (typed && typed !== phone) return { error: deny(403, 'Nomor tidak sama dengan akun yang masuk.') };
    return { phone };
  }
  if (!customerAuthConfig().legacy) return { error: deny(401, 'Masuk lewat WhatsApp/email terlebih dahulu.') };
  if (!typed) return { error: deny(401, 'Masuk terlebih dahulu.') };
  return { phone: typed };
}

const fail = (e: { code?: string; message: string } | null) => {
  if (e) throw new Error(`${e.code ?? ''} ${e.message}`.trim());
};

async function listOwn(db: Db, phone: string) {
  const { data, error } = await db
    .from(TABLE)
    .select(ADDRESS_COLUMNS)
    .in('customer_phone', phoneLookupKeys(phone))
    .order('created_at', { ascending: true })
    .limit(100);
  fail(error);
  return (data || []) as Record<string, unknown>[];
}

/** Exactly one primary among the customer's rows. */
async function setPrimary(db: Db, rows: Record<string, unknown>[], id: string) {
  for (const r of rows) {
    const want = String(r.id) === id;
    if ((r.is_primary === true) !== want) {
      const { error } = await db.from(TABLE).update({ is_primary: want }).eq('id', String(r.id));
      fail(error);
    }
  }
}

const reply = async (db: Db, phone: string) =>
  NextResponse.json({ addresses: toSavedAddresses(await listOwn(db, phone)) }, { headers: noStore });

export async function GET(req: NextRequest) {
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu sering. Coba lagi sebentar lagi.');
  // Legacy login only: the phone travels in a header, not in the URL (no logs).
  const who = customerPhone(req, req.headers.get('x-customer-phone'));
  if ('error' in who) return who.error;
  try {
    return await reply(paymentServiceDb(), who.phone);
  } catch (e) {
    await insertErrorLog({ source: 'customer_addresses', code: 'ADDRESS_LIST_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Alamat belum bisa dimuat.');
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) return deny(403, 'Permintaan ditolak.');
  if (!perIp(clientIp(req) || 'unknown')) return deny(429, 'Terlalu sering. Coba lagi sebentar lagi.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = customerPhone(req, body.phone);
  if ('error' in who) return who.error;
  const action = String(body.action || '');

  try {
    const db = paymentServiceDb();
    const rows = await listOwn(db, who.phone);
    const own = (id: unknown) => (isAddressId(id) ? rows.find((r) => String(r.id) === id) : undefined);

    if (action === 'save') {
      const check = validateAddressDraft(body.address);
      if (!check.ok) return deny(400, check.error);
      const d = check.draft;
      const fields = { label_name: d.label_name, full_address: d.full_address, latitude: d.latitude, longitude: d.longitude };
      // Only this customer's own row is updated; any other id (someone else's, or a
      // client-side "local_…" id) is saved as a new row.
      let id = d.id && own(d.id) ? d.id : '';
      if (id) {
        const { error } = await db.from(TABLE).update(fields).eq('id', id);
        fail(error);
      } else {
        if (rows.length >= MAX_ADDRESSES_PER_CUSTOMER) return deny(400, `Maksimal ${MAX_ADDRESSES_PER_CUSTOMER} alamat tersimpan.`);
        const { data, error } = await db
          .from(TABLE)
          .insert([{ ...fields, customer_phone: who.phone, is_primary: rows.length === 0 }])
          .select('id');
        fail(error);
        id = String(data?.[0]?.id || '');
      }
      const after = await listOwn(db, who.phone);
      if (id && (d.is_primary || after.length === 1)) await setPrimary(db, after, id);
      return await reply(db, who.phone);
    }

    if (action === 'delete') {
      const row = own(body.id);
      if (!row) return deny(404, 'Alamat tidak ditemukan.');
      const { error } = await db.from(TABLE).delete().eq('id', String(row.id));
      fail(error);
      const after = await listOwn(db, who.phone);
      if (row.is_primary === true && after.length) await setPrimary(db, after, String(after[0].id));
      return await reply(db, who.phone);
    }

    if (action === 'primary') {
      const row = own(body.id);
      if (!row) return deny(404, 'Alamat tidak ditemukan.');
      await setPrimary(db, rows, String(row.id));
      return await reply(db, who.phone);
    }

    return deny(400, 'Aksi tidak dikenal.');
  } catch (e) {
    await insertErrorLog({ source: 'customer_addresses', code: 'ADDRESS_WRITE_FAILED', message: String((e as Error)?.message || e).slice(0, 300) });
    return deny(500, 'Alamat belum tersimpan. Coba lagi sebentar lagi.');
  }
}
