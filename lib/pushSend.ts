import webpush from 'web-push';
import { phoneVariants } from '@/lib/csChat';
import { supabase } from '@/lib/supabaseClient';
import { VAPID_PUBLIC_KEY } from '@/lib/vapidPublic';
import type { PushDispatch } from '@/lib/notifications';

const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || '3O9bWmfxXHrmZUl3T7Mqw5pvqgZdGZSuZKKWAEadtNY';

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hello@laundrivery.id';

type SubRow = {
  id?: string;
  user_id?: string;
  role?: string | null;
  endpoint?: string;
  p256dh?: string | null;
  auth?: string | null;
  keys?: { p256dh?: string; auth?: string } | string | null;
  outlet_id?: string | null;
};

let vapidReady = false;
const initVapid = () => {
  if (vapidReady) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
};

const keysOf = (row: SubRow) => {
  let parsed: { p256dh?: string; auth?: string } | null = null;
  if (row.keys && typeof row.keys === 'object') parsed = row.keys;
  else if (typeof row.keys === 'string') {
    try {
      parsed = JSON.parse(row.keys);
    } catch {
      parsed = null;
    }
  }
  return {
    p256dh: String(row.p256dh || parsed?.p256dh || ''),
    auth: String(row.auth || parsed?.auth || '')
  };
};

const dropGone = async (endpoint: string) => {
  try {
    await supabase.from('user_push_subscriptions').delete().eq('endpoint', endpoint);
  } catch {
    /* ignore */
  }
};

const sendToRows = async (rows: SubRow[], event: PushDispatch) => {
  if (!initVapid()) return { sent: 0 };
  const payload = JSON.stringify({
    title: event.title,
    body: event.body,
    url: event.url || '/customer/dashboard',
    icon: '/icon-192.png',
    kind: event.kind,
    tag: event.kind === 'customer_chat' ? 'customer-chat' : event.kind || undefined
  });
  let sent = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const endpoint = String(row.endpoint || '');
    const keys = keysOf(row);
    if (!endpoint || !keys.p256dh || !keys.auth || seen.has(endpoint)) continue;
    seen.add(endpoint);
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
        payload
      );
      sent += 1;
    } catch (err: any) {
      const code = Number(err?.statusCode || err?.status || 0);
      if (code === 404 || code === 410) await dropGone(endpoint);
    }
  }
  return { sent };
};

export async function sendPushNotification(event: PushDispatch): Promise<{ sent: number }> {
  if (!event?.title) return { sent: 0 };
  const { data } = await supabase.from('user_push_subscriptions').select('*').limit(400);
  const rows = (data || []) as SubRow[];
  let matched: SubRow[] = [];

  if (event.phone) {
    const variants = new Set(phoneVariants(event.phone).map((x) => x.toLowerCase()));
    matched = rows.filter((r) => {
      const id = String(r.user_id || '').toLowerCase();
      const role = String(r.role || '').toLowerCase();
      return variants.has(id) && (role === 'customer' || !role);
    });
  } else if (event.userId) {
    matched = rows.filter((r) => String(r.user_id) === String(event.userId));
  }

  if (event.roles?.length) {
    const want = new Set(event.roles.map((r) => r.toLowerCase()));
    const outlet = String(event.outletId || '').trim();
    const staff = rows.filter((r) => want.has(String(r.role || '').toLowerCase()));
    const scoped = outlet
      ? staff.filter((r) => {
          const oid = String(r.outlet_id || '').trim();
          return !oid || oid === 'ALL' || oid === outlet;
        })
      : staff;
    matched = [...matched, ...scoped];
  } else if (event.role) {
    matched = [
      ...matched,
      ...rows.filter((r) => String(r.role || '').toLowerCase() === String(event.role).toLowerCase())
    ];
  }

  return sendToRows(matched, event);
}
