import { insertChatMessage } from '@/lib/csChat';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { findPickupIdByTransaction } from '@/lib/pickupDispatch';

export const COURIER_VENDORS = [
  { value: 'GoSend', label: 'GoSend', color: 'bg-green-600' },
  { value: 'GrabExpress', label: 'GrabExpress', color: 'bg-emerald-700' },
  { value: 'Lalamove', label: 'Lalamove', color: 'bg-orange-500' },
  { value: 'Borzo', label: 'Borzo', color: 'bg-sky-600' },
  { value: 'Lainnya', label: 'Lainnya', color: 'bg-slate-600' }
] as const;

export type CourierVendor = (typeof COURIER_VENDORS)[number]['value'];

export type ThirdPartyPayload = {
  vendor: string;
  driver: string;
  trackingUrl: string;
  photoUrl: string;
  transactionId: string;
  receipt: string;
};

const enc = (v: any) => encodeURIComponent(String(v || ''));
const dec = (v: any) => {
  try {
    return decodeURIComponent(String(v || ''));
  } catch {
    return String(v || '');
  }
};

export const TP_DELIVERY_TAG_RE =
  /\[TPDELIVERY\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)\|([^\]|]*)\]/;

export const parseThirdPartyDelivery = (message: any): ThirdPartyPayload | null => {
  const text = typeof message === 'string' ? message : String(message?.message || '');
  const m = text.match(TP_DELIVERY_TAG_RE);
  if (!m) return null;
  return {
    vendor: dec(m[1]) || 'Lainnya',
    driver: dec(m[2]),
    trackingUrl: dec(m[3]),
    photoUrl: dec(m[4]),
    transactionId: dec(m[5]),
    receipt: dec(m[6])
  };
};

export const stripTpDeliveryTag = (text: string) => String(text || '').replace(TP_DELIVERY_TAG_RE, '').trim();

export const buildTpDeliveryTag = (p: ThirdPartyPayload) =>
  `[TPDELIVERY|${enc(p.vendor)}|${enc(p.driver)}|${enc(p.trackingUrl)}|${enc(p.photoUrl)}|${enc(p.transactionId)}|${enc(p.receipt)}]`;

export const vendorMetaOf = (vendor: any) =>
  COURIER_VENDORS.find((v) => v.value.toLowerCase() === String(vendor || '').toLowerCase()) || COURIER_VENDORS[4];

export const isThirdPartyDelivery = (order: any) => {
  const type = String(order?.courier_type || '').toUpperCase();
  return (
    type === 'THIRD_PARTY' ||
    Boolean(order?.tracking_url || order?.third_party_tracking_url || order?.courier_vendor || order?.handover_photo_url)
  );
};

export const thirdPartyFromOrder = (order: any): ThirdPartyPayload | null => {
  if (!order) return null;
  const url = String(order.tracking_url || order.third_party_tracking_url || '').trim();
  const vendor = String(order.courier_vendor || '').trim();
  const driver = String(order.driver_name_and_plate || order.driver_name || '').trim();
  const photo = String(order.handover_photo_url || '').trim();
  if (!url && !vendor && !driver && !photo) return null;
  return {
    vendor: vendor || 'Lainnya',
    driver,
    trackingUrl: url,
    photoUrl: photo,
    transactionId: String(order.receipt_number ? order.id : order.transaction_id || order.id || ''),
    receipt: String(order.receipt_number || order.order_number || '')
  };
};

export async function dispatchThirdPartyDelivery(opts: {
  order: any;
  vendor: string;
  driverNameAndPlate: string;
  trackingUrl: string;
  handoverPhotoUrl: string;
  agentName?: string;
}) {
  const order = opts.order || {};
  const vendor = String(opts.vendor || '').trim();
  const driver = String(opts.driverNameAndPlate || '').trim();
  const trackingUrl = String(opts.trackingUrl || '').trim();
  const photo = String(opts.handoverPhotoUrl || '').trim();
  if (!vendor) return { error: { message: 'Pilih vendor kurir' } };
  if (!driver) return { error: { message: 'Isi nama driver dan plat nomor' } };
  if (!trackingUrl || !/^https?:\/\//i.test(trackingUrl)) {
    return { error: { message: 'Tempel URL tracking dari aplikasi kurir (http/https)' } };
  }
  if (!photo) return { error: { message: 'Foto serah terima ke kurir wajib diunggah' } };

  const isTx = Boolean(order.receipt_number);
  const txId = isTx ? order.id : order.transaction_id || null;
  const pickupId = isTx ? order.pickup_id || (txId ? await findPickupIdByTransaction(String(txId)) : null) : order.id;
  const phone = order.customer_phone || order.phone_number || '';
  const receipt = order.receipt_number || order.order_number || '';
  const payload: ThirdPartyPayload = {
    vendor,
    driver,
    trackingUrl,
    photoUrl: photo,
    transactionId: String(txId || ''),
    receipt: String(receipt)
  };

  const txPatch = {
    status: 'Diantar',
    courier_type: 'THIRD_PARTY',
    courier_vendor: vendor,
    driver_name_and_plate: driver,
    tracking_url: trackingUrl,
    handover_photo_url: photo
  };
  const pickupPatch = {
    ...txPatch,
    third_party_tracking_url: trackingUrl,
    driver_name: driver
  };

  if (txId) {
    const { error } = await updateWithFallback(
      'transactions',
      [txPatch, { status: 'Diantar', courier_type: 'THIRD_PARTY', tracking_url: trackingUrl }, { status: 'Diantar' }],
      { column: 'id', value: txId }
    );
    if (error) return { error };
  }
  if (pickupId) {
    await updateWithFallback(
      'pickup_orders',
      [pickupPatch, { status: 'Diantar', third_party_tracking_url: trackingUrl }, { status: 'Diantar' }],
      { column: 'id', value: pickupId }
    );
  }

  await insertWithFallback('third_party_deliveries', [
    {
      transaction_id: txId ? String(txId) : null,
      pickup_order_id: pickupId ? String(pickupId) : null,
      customer_phone: phone || null,
      receipt_number: receipt || null,
      courier_vendor: vendor,
      driver_name_and_plate: driver,
      tracking_url: trackingUrl,
      handover_photo_url: photo,
      status: 'dispatched'
    },
    {
      transaction_id: txId ? String(txId) : null,
      customer_phone: phone || null,
      courier_vendor: vendor,
      tracking_url: trackingUrl,
      status: 'dispatched'
    }
  ]);

  if (phone) {
    await insertChatMessage({
      customer_phone: phone,
      pickup_order_id: pickupId || null,
      transaction_id: txId || null,
      sender_type: 'cs',
      sender_name: opts.agentName || 'Kasir',
      message: [
        `Cucian${receipt ? ` resi ${receipt}` : ''} sudah diserahkan ke kurir ${vendor}.`,
        buildTpDeliveryTag(payload),
        'Ketuk kartu untuk lacak kurir. Konfirmasi jika cucian sudah diterima.'
      ].join('\n')
    });
  }

  return { error: null, payload };
}

export async function confirmThirdPartyReceived(order: any) {
  const isTx = Boolean(order?.receipt_number);
  const txId = isTx ? order.id : order.transaction_id || null;
  const pickupId = isTx ? order.pickup_id : order.id;
  const now = new Date().toISOString();

  if (txId) {
    const { error } = await updateWithFallback('transactions', [{ status: 'Selesai' }], { column: 'id', value: txId });
    if (error) return { error };
  }
  if (pickupId) {
    await updateWithFallback('pickup_orders', [{ status: 'Selesai' }], { column: 'id', value: pickupId });
  }
  if (txId) {
    await updateWithFallback(
      'third_party_deliveries',
      [{ status: 'received', received_at: now }, { status: 'received' }],
      { column: 'transaction_id', value: String(txId) }
    );
  }

  const phone = order?.customer_phone || order?.phone_number;
  if (phone) {
    await insertChatMessage({
      customer_phone: phone,
      pickup_order_id: pickupId || null,
      transaction_id: txId || null,
      sender_type: 'customer',
      sender_name: order?.customer_name || 'Pelanggan',
      message: `Pelanggan mengonfirmasi cucian${order?.receipt_number ? ` resi ${order.receipt_number}` : ''} sudah diterima.`
    });
  }

  return { error: null };
}
