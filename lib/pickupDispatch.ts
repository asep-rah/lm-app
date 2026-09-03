import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { supabase } from '@/lib/supabaseClient';
import { updatePickupOrder } from '@/lib/pickupUpdates';
import { notifyStaffNewOrder } from '@/lib/notifications';

const schemaMissesColumn = (err: { message?: string } | null | undefined, column: string) => {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('schema cache') && msg.includes(column.toLowerCase());
};

export async function findPickupIdByTransaction(txId: string): Promise<string | null> {
  if (!txId) return null;
  try {
    const { data, error } = await supabase
      .from('pickup_orders')
      .select('id')
      .eq('transaction_id', txId)
      .limit(1);
    if (error) {
      if (schemaMissesColumn(error, 'transaction_id')) return null;
      return null;
    }
    return data?.[0]?.id || null;
  } catch {
    return null;
  }
}

export async function insertPickupOrder(
  payload: Record<string, unknown>
): Promise<{ data: { id: string }[] | null; error: { message: string } | null }> {
  const omit = (row: Record<string, unknown>, keys: string[]) => {
    const next = { ...row };
    keys.forEach((k) => {
      delete next[k];
    });
    return next;
  };
  const core = {
    outlet_id: payload.outlet_id || null,
    customer_name: payload.customer_name || 'Pelanggan',
    customer_phone: payload.customer_phone || payload.phone_number || null,
    service_type: payload.service_type || payload.service_detail || 'Pickup',
    address: payload.address || payload.pickup_address || '',
    notes: payload.notes || null,
    status: payload.status || 'Menunggu Kurir',
    transaction_id: payload.transaction_id || null
  };
  const coreNoTx = {
    outlet_id: core.outlet_id,
    customer_name: core.customer_name,
    customer_phone: core.customer_phone,
    service_type: core.service_type,
    address: core.address,
    notes: core.notes,
    status: core.status
  };
  const scheduled = {
    pickup_date: payload.pickup_date || null,
    pickup_time: payload.pickup_time || null,
    scheduled_at: payload.scheduled_at || payload.pickup_at || null
  };

  const result = await insertWithFallback<{ id: string }>(
    'pickup_orders',
    [
      payload,
      omit(payload, ['created_at', 'address_id', 'driver_id', 'accepted_at', 'courier_type']),
      omit(payload, [
        'created_at',
        'address_id',
        'driver_id',
        'accepted_at',
        'courier_type',
        'scheduled_at',
        'pickup_at',
        'items',
        'has_fading',
        'has_valuables',
        'wash_process',
        'bag_count',
        'latitude',
        'longitude',
        'formatted_address'
      ]),
      {
        ...core,
        phone_number: core.customer_phone,
        estimated_weight: payload.estimated_weight,
        delivery_fee: payload.delivery_fee,
        duration: payload.duration,
        order_number: payload.order_number,
        ...scheduled
      },
      { ...core, pickup_date: scheduled.pickup_date, pickup_time: scheduled.pickup_time, status: payload.status },
      { ...core, pickup_date: scheduled.pickup_date, status: payload.status },
      { ...core, status: payload.status },
      { ...core, pickup_date: scheduled.pickup_date, pickup_time: scheduled.pickup_time, status: 'Menunggu Kurir' },
      core,
      { ...core, phone_number: core.customer_phone, transaction_id: undefined },
      coreNoTx
    ],
    { select: 'id' }
  );
  if (!result.error) {
    notifyStaffNewOrder({
      outletId: String(payload.outlet_id || core.outlet_id || '') || null,
      customerName: String(core.customer_name || ''),
      service: String(core.service_type || '')
    });
  }
  return result;
}

export async function createPickupRoleTasks(order: {
  id?: string;
  customer_name?: string;
  customer_phone?: string;
  outlet_id?: string;
}) {
  if (!order?.id) return;
  const due = new Date();
  due.setHours(due.getHours() + 2);
  const desc = `${order.customer_name || 'Pelanggan'} · ${order.customer_phone || ''}`.trim();

  for (const role of ['driver', 'cs'] as const) {
    await insertWithFallback('system_tasks', [
      {
        title: `Pickup online — ${order.customer_name || 'Pelanggan'}`,
        description: desc,
        assigned_to_role: role,
        sla_hours: 2,
        due_date: due.toISOString(),
        kpi_penalty_points: 5,
        status: 'pending',
        source_type: 'PICKUP',
        source_id: order.id
      },
      {
        title: `Pickup online — ${order.customer_name || 'Pelanggan'}`,
        description: desc,
        assigned_to_role: role,
        due_date: due.toISOString(),
        status: 'pending'
      },
      {
        title: `Pickup online — ${order.customer_name || 'Pelanggan'}`,
        description: desc,
        assigned_to_role: role,
        status: 'pending'
      }
    ]);
  }
}

/** Tugas driver (kartu portal) plus CS & Admin Ops. */
export async function createDeliveryRequestTasks(order: {
  id?: string;
  customer_name?: string;
  customer_phone?: string;
  notes?: string;
  outlet_id?: string;
}) {
  if (!order?.id) return;
  const due = new Date();
  due.setHours(due.getHours() + 4);
  const desc =
    `${order.customer_name || 'Pelanggan'} · ${order.customer_phone || ''} · ${order.notes || 'Request Pengantaran Customer'}`.trim();

  for (const role of ['driver', 'cs', 'admin_ops'] as const) {
    const title = role === 'driver' ? 'Pengantaran ke pelanggan' : 'Request Pengantaran Customer';
    await insertWithFallback('system_tasks', [
      {
        title,
        description: desc,
        assigned_to_role: role,
        sla_hours: 4,
        due_date: due.toISOString(),
        kpi_penalty_points: 5,
        status: 'pending',
        source_type: 'CUSTOMER_DELIVERY',
        source_id: order.id,
        outlet_id: order.outlet_id || null
      },
      {
        title,
        description: desc,
        assigned_to_role: role,
        due_date: due.toISOString(),
        status: 'pending',
        source_id: order.id
      },
      {
        title,
        description: desc,
        assigned_to_role: role,
        status: 'pending'
      }
    ]);
  }
}

/** Status Siap Diantar + kartu pickup_orders untuk Portal Driver. */
export async function requestDriverDelivery(opts: {
  order: any;
  customerName?: string;
  customerPhone: string;
  customerAddress?: string;
  selectedOutlet?: string;
}): Promise<{ error: { message: string } | null; pickupId?: string | null }> {
  const order = opts.order || {};
  const notes = `Request Pengantaran Customer · ${order.receipt_number || order.order_number || order.id}`;
  const isPosOrder = Boolean(order.receipt_number);
  const outletId = order.outlet_id || opts.selectedOutlet || null;
  let pickupId = isPosOrder ? order.pickup_id || null : order.id;

  if (isPosOrder && !pickupId) {
    pickupId = await findPickupIdByTransaction(order.id);
  }

  let updated = false;
  if (pickupId) {
    const patch: Record<string, any> = {
      status: 'Siap Diantar',
      notes: `${order.notes || ''} | ${notes}`.trim()
    };
    if (outletId) patch.outlet_id = outletId;
    const { error } = await updatePickupOrder(pickupId, patch);
    if (!error) updated = true;
    else {
      const retry = await updatePickupOrder(pickupId, { status: 'Siap Diantar' });
      updated = !retry.error;
    }
  }

  if (!updated) {
    const { data, error } = await insertPickupOrder({
      outlet_id: outletId,
      customer_name: opts.customerName || order.customer_name || 'Pelanggan',
      customer_phone: opts.customerPhone,
      phone_number: opts.customerPhone,
      service_type: order.service_type || 'Antar cucian',
      address: opts.customerAddress || order.address || '',
      notes,
      status: 'Siap Diantar',
      transaction_id: isPosOrder ? order.id : undefined
    });
    if (error) return { error };
    pickupId = data?.[0]?.id || pickupId;
  }

  if (isPosOrder && order.id) {
    await updateWithFallback(
      'transactions',
      [
        { status: 'Siap Diantar', delivery_requested: true },
        { status: 'Siap Diantar' }
      ],
      { column: 'id', value: order.id }
    );
  }

  await createDeliveryRequestTasks({
    id: pickupId || order.id,
    customer_name: opts.customerName || order.customer_name,
    customer_phone: opts.customerPhone,
    notes,
    outlet_id: outletId
  });

  return { error: null, pickupId };
}
