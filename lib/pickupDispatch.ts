import { insertWithFallback } from '@/lib/safeWrite';

export async function insertPickupOrder(
  payload: Record<string, unknown>
): Promise<{ data: { id: string }[] | null; error: { message: string } | null }> {
  const core = {
    outlet_id: payload.outlet_id || null,
    customer_name: payload.customer_name || 'Pelanggan',
    customer_phone: payload.customer_phone || payload.phone_number || null,
    service_type: payload.service_type || payload.service_detail || 'Pickup',
    address: payload.address || payload.pickup_address || '',
    notes: payload.notes || null,
    status: payload.status || 'Baru Masuk',
    transaction_id: payload.transaction_id || null
  };

  return insertWithFallback<{ id: string }>(
    'pickup_orders',
    [
      payload,
      { ...payload, items: undefined, has_fading: undefined, has_valuables: undefined, wash_process: undefined, bag_count: undefined },
      { ...core, phone_number: core.customer_phone, estimated_weight: payload.estimated_weight, delivery_fee: payload.delivery_fee, duration: payload.duration, order_number: payload.order_number },
      core
    ],
    { select: 'id' }
  );
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

/** Tugas ke Admin Ops & CS agar menugaskan driver antar ke pelanggan. */
export async function createDeliveryRequestTasks(order: {
  id?: string;
  customer_name?: string;
  customer_phone?: string;
  notes?: string;
}) {
  if (!order?.id) return;
  const due = new Date();
  due.setHours(due.getHours() + 4);
  const desc =
    `${order.customer_name || 'Pelanggan'} · ${order.customer_phone || ''} · ${order.notes || 'Request Pengantaran Customer'}. Assign driver internal untuk drop-off.`.trim();

  for (const role of ['cs', 'admin_ops'] as const) {
    await insertWithFallback('system_tasks', [
      {
        title: 'Request Pengantaran Customer',
        description: desc,
        assigned_to_role: role,
        sla_hours: 4,
        due_date: due.toISOString(),
        kpi_penalty_points: 5,
        status: 'pending',
        source_type: 'CUSTOMER_DELIVERY',
        source_id: order.id
      },
      {
        title: 'Request Pengantaran Customer',
        description: desc,
        assigned_to_role: role,
        due_date: due.toISOString(),
        status: 'pending'
      },
      {
        title: 'Request Pengantaran Customer',
        description: desc,
        assigned_to_role: role,
        status: 'pending'
      }
    ]);
  }
}
