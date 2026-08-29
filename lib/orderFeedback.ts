import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { createIssueTasksForRoles } from '@/lib/createOutletIssueTask';

export const COMPLAINT_WINDOW_MS = 24 * 60 * 60 * 1000;

const localKey = (kind: 'confirm' | 'complain' | 'review' | 'auto', id: string) =>
  `laundry_${kind}_${id}`;

export const readLocalFlag = (kind: 'confirm' | 'complain' | 'review' | 'auto', id: string) => {
  if (!id || typeof window === 'undefined') return false;
  try {
    return Boolean(localStorage.getItem(localKey(kind, id)));
  } catch {
    return false;
  }
};

export const writeLocalFlag = (kind: 'confirm' | 'complain' | 'review' | 'auto', id: string) => {
  if (!id || typeof window === 'undefined') return;
  try {
    localStorage.setItem(localKey(kind, id), '1');
  } catch {
    /* ignore */
  }
};

export const orderCompletedAt = (order: any): Date | null => {
  const raw =
    order?.delivered_at ||
    order?.completed_at ||
    order?.date ||
    order?.updated_at ||
    order?.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
};

export const complaintStatusOf = (order: any): string => {
  const st = String(order?.complaint_status || '').toLowerCase().trim();
  if (st) return st;
  if (order?.confirmed_at) return 'confirmed';
  if (order?.id && readLocalFlag('complain', order.id)) return 'pending_resolution';
  if (order?.id && readLocalFlag('confirm', order.id)) return 'confirmed';
  if (order?.id && readLocalFlag('auto', order.id)) return 'auto_confirmed';
  return '';
};

export const showComplaintActions = (order: any) => {
  const st = complaintStatusOf(order);
  if (st.includes('pending')) {
    return { showConfirm: false, showComplain: false, autoConfirmed: false, pending: true, locked: true };
  }
  if (['confirmed', 'locked', 'sudah sesuai'].includes(st) || order?.confirmed_at) {
    return { showConfirm: false, showComplain: false, autoConfirmed: false, pending: false, locked: true };
  }
  if (st.includes('auto')) {
    return { showConfirm: false, showComplain: false, autoConfirmed: true, pending: false, locked: true };
  }
  const at = orderCompletedAt(order);
  const elapsed = at ? Date.now() - at.getTime() : 0;
  if (at && elapsed > COMPLAINT_WINDOW_MS) {
    return { showConfirm: false, showComplain: false, autoConfirmed: true, pending: false, locked: true };
  }
  return { showConfirm: true, showComplain: true, autoConfirmed: false, pending: false, locked: false };
};

const isPosOrder = (order: any) => Boolean(order?.receipt_number);

export const patchOrderComplaint = async (
  order: any,
  payload: Record<string, unknown>
): Promise<{ error: { message: string } | null }> => {
  if (!order?.id) return { error: { message: 'Pesanan tidak ditemukan' } };
  const attempts = [
    payload,
    { complaint_status: payload.complaint_status },
    { confirmed_at: payload.confirmed_at }
  ].filter((row) => Object.values(row).some((v) => v !== undefined));

  if (isPosOrder(order)) {
    const tx = await updateWithFallback('transactions', attempts, { column: 'id', value: order.id });
    if (order.pickup_id) {
      await updateWithFallback('pickup_orders', attempts, { column: 'id', value: order.pickup_id });
    }
    return tx;
  }
  return updateWithFallback('pickup_orders', attempts, { column: 'id', value: order.id });
};

export const maybeAutoConfirmOrder = async (order: any) => {
  const ui = showComplaintActions(order);
  if (!ui.autoConfirmed || complaintStatusOf(order).includes('auto') || complaintStatusOf(order) === 'confirmed') {
    return order;
  }
  if (order?.id) writeLocalFlag('auto', order.id);
  await patchOrderComplaint(order, {
    complaint_status: 'auto_confirmed',
    confirmed_at: new Date().toISOString()
  });
  return { ...order, complaint_status: 'auto_confirmed', confirmed_at: new Date().toISOString() };
};

export const markOrderConfirmed = async (order: any) => {
  const now = new Date().toISOString();
  if (order?.id) writeLocalFlag('confirm', order.id);
  const { error } = await patchOrderComplaint(order, {
    complaint_status: 'confirmed',
    confirmed_at: now
  });
  return { error, order: { ...order, complaint_status: 'confirmed', confirmed_at: now } };
};

export const submitOrderComplaint = async (opts: {
  order: any;
  description: string;
  photoUrl?: string;
  customerName?: string;
  customerPhone?: string;
}) => {
  const order = opts.order || {};
  const desc = String(opts.description || '').trim();
  if (!desc) return { error: { message: 'Isi deskripsi kendala' } };

  const txId = isPosOrder(order) ? order.id : order.transaction_id || null;
  const pickupId = order.pickup_id || (!isPosOrder(order) ? order.id : null);
  const reporter = opts.customerName || order.customer_name || 'Pelanggan';
  const body = [
    `Komplain pelanggan (SLA 24 jam)`,
    opts.customerPhone ? `HP: ${opts.customerPhone}` : '',
    order.receipt_number ? `Resi: ${order.receipt_number}` : '',
    desc,
    opts.photoUrl ? `Bukti: ${opts.photoUrl}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const { data, error } = await insertWithFallback<{ id: string }>(
    'outlet_issues',
    [
      {
        outlet_id: order.outlet_id || null,
        category: 'Komplain Pelanggan',
        title: 'Komplain Pelanggan',
        description: body,
        reporter_name: reporter,
        created_by_name: reporter,
        urgency: 'Mendesak',
        priority: 'high',
        status: 'pending_resolution',
        media_url: opts.photoUrl || null,
        transaction_id: txId,
        pickup_id: pickupId,
        assigned_to_role: 'supervisor'
      },
      {
        outlet_id: order.outlet_id || null,
        category: 'Komplain Pelanggan',
        description: body,
        reporter_name: reporter,
        urgency: 'Mendesak',
        status: 'pending_resolution',
        media_url: opts.photoUrl || null
      },
      {
        outlet_id: order.outlet_id || null,
        category: 'Komplain Pelanggan',
        description: body,
        reporter_name: reporter,
        status: 'Perlu Penanganan'
      },
      {
        outlet_id: order.outlet_id || null,
        description: body,
        status: 'Sedang Diproses'
      },
      { description: body }
    ],
    { select: 'id' }
  );
  if (error) return { error };

  if (data?.[0]?.id) {
    await createIssueTasksForRoles(
      {
        id: data[0].id,
        category: 'Komplain Pelanggan',
        description: desc,
        reporter_name: reporter,
        urgency: 'mendesak'
      },
      ['supervisor', 'cs']
    );
  }

  if (order?.id) writeLocalFlag('complain', order.id);
  const patch = await patchOrderComplaint(order, { complaint_status: 'pending_resolution' });
  return {
    error: patch.error,
    order: { ...order, complaint_status: 'pending_resolution' }
  };
};

export const submitOrderReview = async (opts: {
  order: any;
  rating: number;
  comment?: string;
  customerId?: string | null;
  customerPhone?: string | null;
}) => {
  const rating = Math.max(1, Math.min(5, Math.round(Number(opts.rating) || 0)));
  if (!rating) return { error: { message: 'Pilih rating 1–5 bintang' } };
  const order = opts.order || {};
  const txId = isPosOrder(order) ? order.id : order.transaction_id || null;
  const pickupId = order.pickup_id || (!isPosOrder(order) ? order.id : null);

  const { error } = await insertWithFallback('order_reviews', [
    {
      transaction_id: txId,
      pickup_id: pickupId,
      outlet_id: order.outlet_id || null,
      customer_id: opts.customerId || null,
      customer_phone: opts.customerPhone || order.customer_phone || null,
      rating,
      comment: String(opts.comment || '').trim() || null
    },
    {
      transaction_id: txId,
      outlet_id: order.outlet_id || null,
      customer_phone: opts.customerPhone || order.customer_phone || null,
      rating,
      comment: String(opts.comment || '').trim() || null
    },
    {
      outlet_id: order.outlet_id || null,
      rating,
      comment: String(opts.comment || '').trim() || null
    },
    { rating, comment: String(opts.comment || '').trim() || null }
  ]);
  if (!error && order?.id) writeLocalFlag('review', order.id);
  return { error };
};
