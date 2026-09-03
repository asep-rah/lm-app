import { insertWithFallback } from '@/lib/safeWrite';
import { playOpsSound, unlockOpsAudio } from '@/lib/opsNotify';
import { getStaffSession } from '@/lib/staffSession';
import { supabase } from '@/lib/supabaseClient';
import { VAPID_PUBLIC_KEY } from '@/lib/vapidPublic';

export type PushKind =
  | 'customer_payment'
  | 'customer_chat'
  | 'customer_status'
  | 'staff_new_order'
  | 'cs_chat'
  | 'cs_pickup'
  | 'cs_complaint'
  | 'crm_campaign'
  | 'crm_retention';

export type PushDispatch = {
  kind: PushKind;
  title: string;
  body: string;
  url?: string;
  phone?: string | null;
  userId?: string | null;
  role?: string | null;
  roles?: string[];
  outletId?: string | null;
};

const STAFF_ORDER_ROLES = ['kasir', 'pos', 'admin', 'admin_ops', 'driver', 'owner', 'supervisor', 'head', 'head_management'];
const CS_PUSH_ROLES = ['cs', 'head_cs', 'cs_care'];

export const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
};

const canonicalPhone = (raw: string) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8') && d.length >= 9 && d.length <= 13) d = '62' + d;
  return d;
};

export const currentPushActor = (): { userId: string; role: string; outletId: string } | null => {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname || '';
  const customerApp = /\/customer|\/beranda|\/aktivitas|\/profil|^\/order/.test(path);
  const phone = String(localStorage.getItem('laundry_customer_phone') || '').trim();
  const session = getStaffSession();
  if (!customerApp && session.id) {
    return { userId: session.id, role: session.role || 'kasir', outletId: session.outletId || '' };
  }
  if (phone) {
    return {
      userId: canonicalPhone(phone) || phone,
      role: 'customer',
      outletId: String(localStorage.getItem('laundry_active_outlet') || '').trim()
    };
  }
  if (session.id) {
    return { userId: session.id, role: session.role || 'kasir', outletId: session.outletId || '' };
  }
  return null;
};

export const registerPushWorker = async () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
};

export const savePushSubscription = async (sub: PushSubscription, actor: { userId: string; role: string; outletId: string }) => {
  const json = sub.toJSON();
  const endpoint = String(json.endpoint || '');
  const p256dh = String(json.keys?.p256dh || '');
  const auth = String(json.keys?.auth || '');
  if (!endpoint || !actor.userId) return { error: { message: 'Subscription tidak lengkap' } };
  const row = {
    user_id: actor.userId,
    role: actor.role,
    endpoint,
    p256dh,
    auth,
    keys: { p256dh, auth },
    outlet_id: actor.outletId || null
  };
  const { error } = await insertWithFallback('user_push_subscriptions', [
    row,
    { user_id: row.user_id, role: row.role, endpoint, p256dh, auth, outlet_id: row.outlet_id },
    { user_id: row.user_id, role: row.role, endpoint, keys: row.keys },
    { user_id: row.user_id, endpoint, p256dh, auth }
  ]);
  if (!error) return { error: null };
  const msg = String(error.message || '').toLowerCase();
  if (msg.includes('duplicate') || msg.includes('unique')) {
    await supabase.from('user_push_subscriptions').delete().eq('endpoint', endpoint);
    return insertWithFallback('user_push_subscriptions', [row, { user_id: row.user_id, endpoint, p256dh, auth }]);
  }
  return { error };
};

export const subscribePush = async () => {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return { ok: false, permission: 'unsupported' as const };
  }
  const actor = currentPushActor();
  if (!actor) return { ok: false, permission: Notification.permission };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, permission };
  try {
    const reg = (await navigator.serviceWorker.ready.catch(() => null)) || (await registerPushWorker());
    if (!reg?.pushManager) return { ok: false, permission };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await savePushSubscription(sub, actor);
    return { ok: true, permission };
  } catch {
    return { ok: false, permission };
  }
};

export const ensurePushSubscription = async () => {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  await registerPushWorker();
  await subscribePush();
};

export const queuePush = (event: PushDispatch) => {
  try {
    const body = JSON.stringify(event);
    if (typeof window === 'undefined') {
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:3000');
      void fetch(`${origin}/api/push/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      }).catch(() => {});
      return;
    }
    void fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  } catch {
    /* ignore */
  }
};

export const notifyCustomerPayment = (phone?: string | null) => {
  if (!phone) return;
  queuePush({
    kind: 'customer_payment',
    phone,
    title: 'Konfirmasi Pembayaran Diterima',
    body: 'Pembayaran Anda sudah dikonfirmasi. Cucian masuk antrean produksi.',
    url: '/customer/dashboard?tab=berlangsung'
  });
};

export const playCustomerChatChime = () => {
  unlockOpsAudio();
  playOpsSound('chat');
};

/** Chime saat chat tidak sedang dibuka. Web Push tetap dikirim dari sisi CS via notifyCustomerChat. */
export const alertCustomerIncomingChat = (opts?: { preview?: string; inChat?: boolean }) => {
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  const inChat = !!opts?.inChat && !hidden;
  if (inChat) return;
  playCustomerChatChime();
};

export const notifyCustomerChat = (phone?: string | null, preview?: string) => {
  if (!phone) return;
  queuePush({
    kind: 'customer_chat',
    phone,
    title: 'Pesan Baru dari CS',
    body: String(preview || 'Ada pesan baru dari customer service.').slice(0, 140),
    url: '/customer/dashboard?open=chat'
  });
};

export const notifyCustomerStatus = (phone: string | null | undefined, status: string | null | undefined) => {
  if (!phone) return;
  const raw = String(status || '').toLowerCase();
  if (raw.includes('diproses_pos') || raw.includes('pos_created')) return;
  let title = '';
  let body = '';
  if (raw.includes('selesai jemput') || raw.includes('diterima') || raw.includes('tiba di outlet')) {
    title = 'Diterima';
    body = 'Cucian Anda sudah diterima di outlet.';
  } else if ((raw.includes('proses') || raw.includes('cuci') || raw.includes('mencuci')) && !raw.includes('pos')) {
    title = 'Proses';
    body = 'Cucian Anda sedang diproses.';
  } else if (
    raw.includes('siap diambil') ||
    (raw.includes('selesai') && !raw.includes('jemput')) ||
    raw.includes('terkirim') ||
    raw.includes('delivered')
  ) {
    title = 'Selesai';
    body = 'Cucian Anda sudah selesai.';
  } else {
    return;
  }
  queuePush({
    kind: 'customer_status',
    phone,
    title,
    body,
    url: '/customer/dashboard?tab=berlangsung'
  });
};

export const notifyStaffNewOrder = (opts: { outletId?: string | null; customerName?: string | null; service?: string | null }) => {
  queuePush({
    kind: 'staff_new_order',
    roles: STAFF_ORDER_ROLES,
    outletId: opts.outletId || null,
    title: 'Order Baru',
    body: `${opts.customerName || 'Pelanggan'} memesan ${opts.service || 'laundry'} — cek antrean outlet.`,
    url: '/pos'
  });
  queuePush({
    kind: 'cs_pickup',
    roles: CS_PUSH_ROLES,
    title: 'Pickup baru',
    body: `${opts.customerName || 'Pelanggan'} mengajukan jemput ${opts.service || 'laundry'}. Assign driver atau kurir instan.`,
    url: '/cs/dashboard'
  });
};

export const notifyCsPortal = (kind: 'cs_chat' | 'cs_pickup' | 'cs_complaint', body: string) => {
  const title =
    kind === 'cs_chat' ? 'Live Chat' : kind === 'cs_pickup' ? 'Pickup baru' : 'Komplain urgent';
  const url = kind === 'cs_chat' ? '/cs' : kind === 'cs_pickup' ? '/cs/dashboard' : '/cs/care';
  queuePush({ kind, roles: CS_PUSH_ROLES, title, body, url });
};
