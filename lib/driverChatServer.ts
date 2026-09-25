/**
 * Server side of the driver ↔ customer order chat (lib/driverChat.ts).
 * Import ONLY from API routes: uses the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { orderPhone08 } from '@/lib/customerOrderServer';
import { DRIVER_CHAT_OPEN_STATUSES, type DriverChatMessage, type DriverChatSender } from '@/lib/driverChat';

export const DRIVER_CHAT_TABLE = 'order_driver_chats';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_COLUMNS = 'id, sender_type, sender_name, message, created_at, read_at';

export type ChatOrder = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  phone_number: string | null;
  driver_name: string | null;
  status: string | null;
};

export const isOrderId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export async function loadChatOrder(db: SupabaseClient, id: string): Promise<ChatOrder | null> {
  const { data, error } = await db
    .from('pickup_orders')
    .select('id, order_number, customer_name, customer_phone, phone_number, driver_name, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
  return (data as ChatOrder) ?? null;
}

/** The order belongs to this customer phone (08… form). */
export const orderBelongsTo = (order: ChatOrder, phone08: string) =>
  Boolean(phone08) && [order.customer_phone, order.phone_number].some((p) => orderPhone08(p) === phone08);

export async function listChatMessages(db: SupabaseClient, orderId: string): Promise<DriverChatMessage[]> {
  const { data, error } = await db
    .from(DRIVER_CHAT_TABLE)
    .select(MESSAGE_COLUMNS)
    .eq('pickup_order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
  return (data || []) as DriverChatMessage[];
}

export async function insertChatMessage(
  db: SupabaseClient,
  row: { orderId: string; sender: DriverChatSender; senderName: string; message: string }
): Promise<DriverChatMessage> {
  const { data, error } = await db
    .from(DRIVER_CHAT_TABLE)
    .insert([{ pickup_order_id: row.orderId, sender_type: row.sender, sender_name: row.senderName || null, message: row.message }])
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
  return data as DriverChatMessage;
}

/** Mark the other side's messages as read by `reader`. */
export async function markChatRead(db: SupabaseClient, orderId: string, reader: DriverChatSender) {
  await db
    .from(DRIVER_CHAT_TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq('pickup_order_id', orderId)
    .eq('sender_type', reader === 'driver' ? 'customer' : 'driver')
    .is('read_at', null);
}

/** Unread counts (messages from `from`) per order id. */
export async function unreadCounts(db: SupabaseClient, orderIds: string[], from: DriverChatSender): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!orderIds.length) return out;
  const { data, error } = await db
    .from(DRIVER_CHAT_TABLE)
    .select('pickup_order_id')
    .in('pickup_order_id', orderIds.slice(0, 100))
    .eq('sender_type', from)
    .is('read_at', null)
    .limit(1000);
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`.trim());
  for (const r of data || []) {
    const id = String((r as { pickup_order_id: string }).pickup_order_id);
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

export const openStatuses = () => [...DRIVER_CHAT_OPEN_STATUSES];
