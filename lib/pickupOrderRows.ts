/**
 * Row builders for pickup_orders / system_tasks shared by the browser path
 * (lib/pickupDispatch) and the server endpoint (/api/customer/order/create).
 * No client imports here. Payload variants go from complete to minimal so an
 * optional column missing in a live schema never rejects the whole order.
 */
import { localDateISO } from '@/lib/customerActivity';

export const newOrderNumber = () => `ORD-${Date.now().toString().slice(-8)}-${Math.floor(1000 + Math.random() * 9000)}`;

export function pickupOrderAttempts(payload: Record<string, unknown>, today: string = localDateISO()): Record<string, unknown>[] {
  const omit = (row: Record<string, unknown>, keys: string[]) => {
    const next = { ...row };
    keys.forEach((k) => {
      delete next[k];
    });
    return next;
  };
  const generatedOrderNum =
    (payload.order_number as string) ||
    newOrderNumber();
  // pickup_orders.pickup_date NOT NULL di produksi: order tanpa jadwal (jemput
  // sekarang, request antar) memakai tanggal lokal hari ini.
  const pickupDate = (payload.pickup_date as string) || today;
  const core = {
    order_number: generatedOrderNum,
    outlet_id: payload.outlet_id || null,
    customer_name: payload.customer_name || 'Pelanggan',
    customer_phone: payload.customer_phone || payload.phone_number || null,
    service_type: payload.service_type || payload.service_detail || 'Pickup',
    address: payload.address || payload.pickup_address || '',
    notes: payload.notes || null,
    status: payload.status || 'Menunggu Kurir',
    transaction_id: payload.transaction_id || null,
    pickup_date: pickupDate
  };
  const coreNoTx = {
    order_number: generatedOrderNum,
    outlet_id: core.outlet_id,
    customer_name: core.customer_name,
    customer_phone: core.customer_phone,
    service_type: core.service_type,
    address: core.address,
    notes: core.notes,
    status: core.status
  };
  const scheduled = {
    pickup_date: pickupDate,
    pickup_time: payload.pickup_time || null,
    scheduled_at: payload.scheduled_at || payload.pickup_at || null
  };

  return [
    { ...payload, pickup_date: pickupDate },
    omit({ ...payload, pickup_date: pickupDate }, ['created_at', 'address_id', 'driver_id', 'accepted_at', 'courier_type']),
    omit({ ...payload, pickup_date: pickupDate }, [
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
  ];
}

export function pickupRoleTaskAttempts(
  order: { id?: string; customer_name?: string; customer_phone?: string },
  role: 'driver' | 'cs',
  due: Date
): Record<string, unknown>[] {
  const desc = `${order.customer_name || 'Pelanggan'} · ${order.customer_phone || ''}`.trim();
  const title = `Pickup online — ${order.customer_name || 'Pelanggan'}`;
  return [
    {
      title,
      description: desc,
      assigned_to_role: role,
      sla_hours: 2,
      due_date: due.toISOString(),
      kpi_penalty_points: 5,
      status: 'pending',
      source_type: 'PICKUP',
      source_id: order.id
    },
    { title, description: desc, assigned_to_role: role, due_date: due.toISOString(), status: 'pending' },
    { title, description: desc, assigned_to_role: role, status: 'pending' }
  ];
}
