/**
 * Customer delivery request ("Minta diantar"), done by the SERVER
 * (/api/customer/delivery-request). Same outcome as the old browser path
 * (lib/pickupDispatch.requestDriverDelivery): the pickup card becomes
 * "Siap Diantar" (or one is created for a POS transaction), the transaction is
 * marked, and driver/CS/Admin Ops tasks are created — but only for an order
 * that belongs to the requesting phone, and only once (a card already
 * "Siap Diantar" is not re-created and gets no new tasks).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { orderPhone08 } from '@/lib/customerOrderServer';
import { deliveryTaskAttempts, pickupOrderAttempts } from '@/lib/pickupOrderRows';

type Db = SupabaseClient;
export type DeliveryResult = { ok: true; pickupId: string; already: boolean } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READY = 'Siap Diantar';

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

async function updateFirst(db: Db, table: string, id: string, attempts: Record<string, unknown>[]) {
  let last = '';
  for (const patch of attempts) {
    const { error } = await db.from(table).update(patch).eq('id', id);
    if (!error) return null;
    last = error.message;
  }
  return last || `update ${table} failed`;
}

export async function requestDeliveryServer(
  db: Db,
  input: { kind: 'pickup' | 'transaction'; orderId: string; phone: string; customerName?: string; address?: string; outletId?: string | null; today: string }
): Promise<DeliveryResult> {
  const phone = orderPhone08(input.phone);
  if (!phone) return { ok: false, status: 400, error: 'Nomor WhatsApp tidak valid.' };
  if (!input.orderId || input.orderId.length > 64) return { ok: false, status: 400, error: 'Pesanan tidak valid.' };

  let pickup: { id: string; status?: string; notes?: string | null; outlet_id?: string | null; customer_name?: string; service_type?: string; address?: string } | null = null;
  let tx: { id: string; receipt_number?: string; outlet_id?: string | null; customer_name?: string; service_type?: string; pickup_id?: string | null } | null = null;

  if (input.kind === 'transaction') {
    const { data, error } = await db
      .from('transactions')
      .select('id, receipt_number, customer_phone, outlet_id, customer_name, service_type, pickup_id')
      .eq('id', input.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || orderPhone08(data.customer_phone) !== phone) return { ok: false, status: 404, error: 'Pesanan tidak ditemukan.' };
    tx = data;
    const found = data.pickup_id
      ? await db.from('pickup_orders').select('id, status, notes, outlet_id').eq('id', String(data.pickup_id)).limit(1)
      : await db.from('pickup_orders').select('id, status, notes, outlet_id').eq('transaction_id', data.id).limit(1);
    if (!found.error && found.data?.[0]) pickup = found.data[0];
  } else {
    const { data, error } = await db
      .from('pickup_orders')
      .select('id, status, notes, outlet_id, customer_phone, customer_name, service_type, address')
      .eq('id', input.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || orderPhone08(data.customer_phone) !== phone) return { ok: false, status: 404, error: 'Pesanan tidak ditemukan.' };
    pickup = data;
  }

  if (pickup && pickup.status === READY) return { ok: true, pickupId: String(pickup.id), already: true };

  const ref = tx?.receipt_number || pickup?.id || input.orderId;
  const notes = `Request Pengantaran Customer · ${ref}`;
  const outletId = (tx?.outlet_id || pickup?.outlet_id || (input.outletId && UUID.test(input.outletId) ? input.outletId : null)) ?? null;
  const customerName = String(input.customerName || tx?.customer_name || pickup?.customer_name || 'Pelanggan').slice(0, 80);

  let pickupId = pickup ? String(pickup.id) : '';
  if (pickup) {
    const err = await updateFirst(db, 'pickup_orders', pickupId, [
      { status: READY, notes: `${pickup.notes || ''} | ${notes}`.trim(), ...(outletId ? { outlet_id: outletId } : {}) },
      { status: READY }
    ]);
    if (err) throw new Error(err);
  } else {
    const created = await insertFirst(
      db,
      'pickup_orders',
      pickupOrderAttempts(
        {
          outlet_id: outletId,
          customer_name: customerName,
          customer_phone: phone,
          phone_number: phone,
          service_type: tx?.service_type || 'Antar cucian',
          address: String(input.address || '').slice(0, 500),
          notes,
          status: READY,
          transaction_id: tx?.id
        },
        input.today
      )
    );
    if (created.error || !created.id) throw new Error(created.error || 'no id');
    pickupId = created.id;
  }

  if (tx) await updateFirst(db, 'transactions', tx.id, [{ status: READY, delivery_requested: true }, { status: READY }]);

  const due = new Date(Date.now() + 4 * 3600_000);
  for (const role of ['driver', 'cs', 'admin_ops'] as const) {
    await insertFirst(db, 'system_tasks', deliveryTaskAttempts({ id: pickupId, customer_name: customerName, customer_phone: phone, notes, outlet_id: outletId }, role, due));
  }
  return { ok: true, pickupId, already: false };
}
