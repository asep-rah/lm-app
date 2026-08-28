import { supabase } from '@/lib/supabaseClient';

const OPTIONAL_KEYS = [
  'accepted_at',
  'picked_up_at',
  'arrived_outlet_at',
  'delivered_at',
  'driver_lat',
  'driver_lon'
];

/**
 * Update pickup_orders. Jika kolom stempel waktu belum ada di schema,
 * payload dipangkas lalu diulang — jangan sampai seluruh update ditolak diam-diam.
 */
export const updatePickupOrder = async (id: string, payload: Record<string, any>) => {
  const first = await supabase.from('pickup_orders').update(payload).eq('id', id);
  if (!first.error) return { error: null };

  const stripped = { ...payload };
  OPTIONAL_KEYS.forEach((k) => delete stripped[k]);
  const second = await supabase.from('pickup_orders').update(stripped).eq('id', id);
  if (!second.error) {
    console.warn('pickup_orders: kolom stempel waktu diabaikan:', first.error.message);
    return { error: null, stripped: true };
  }

  const statusOnly: Record<string, any> = { status: payload.status };
  if (payload.photo_url) statusOnly.photo_url = payload.photo_url;
  if (payload.photo_outlet_url) statusOnly.photo_outlet_url = payload.photo_outlet_url;
  if (payload.photo_delivery_url) statusOnly.photo_delivery_url = payload.photo_delivery_url;
  const third = await supabase.from('pickup_orders').update(statusOnly).eq('id', id);
  if (third.error) return { error: third.error };
  console.warn('pickup_orders: payload dipangkas ke status/foto:', second.error.message);
  return { error: null, stripped: true };
};

/** Catatan waktu kurir ke work_logs bila ada transaction_id; gagal tidak membatalkan status. */
export const logCourierStage = async (order: any, stage: string, employeeName: string) => {
  const txId = order?.transaction_id || order?.tx_id;
  if (!txId) return;

  const { error } = await supabase.from('work_logs').insert([
    {
      transaction_id: txId,
      employee_name: employeeName || 'Kurir',
      stage,
      service_type: order.service_type || 'Pickup',
      weight_kg: Number(order.estimated_weight) || 0,
      pcs_count: 0,
      photo_url: order._proofUrl || null,
      created_at: new Date().toISOString()
    }
  ]);

  if (error) {
    const retry = await supabase.from('work_logs').insert([
      {
        transaction_id: txId,
        employee_name: employeeName || 'Kurir',
        stage,
        service_type: order.service_type || 'Pickup',
        weight_kg: 0,
        pcs_count: 0
      }
    ]);
    if (retry.error) console.warn('work_logs kurir:', retry.error.message);
  }
};
