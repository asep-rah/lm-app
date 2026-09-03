import { canonicalPhone, isStaffOnlyMessage, mapChatMessage, phoneVariants, type ChatMessage } from '@/lib/csChat';
import { supabase } from '@/lib/supabaseClient';

const seenKey = (phone: string) => `laundry_customer_chat_seen_${canonicalPhone(phone) || phone}`;

const schemaMisses = (err: { message?: string } | null | undefined, column: string) => {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes(column.toLowerCase()) && (msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('column'));
};

export const isIncomingStaffChat = (row: any) => {
  if (!row || isStaffOnlyMessage(row)) return false;
  const t = String(row.sender_type || '').toLowerCase();
  if (!t) return false;
  if (t === 'customer' || t === 'user' || t === 'pelanggan' || t === 'ai') return false;
  return true;
};

export const chatBelongsToCustomer = (row: any, phone: string) => {
  if (!row || !phone) return false;
  const variants = new Set(phoneVariants(phone).map((v) => String(v).replace(/\D/g, '')));
  const rowPhone = String(row.customer_phone || '').replace(/\D/g, '');
  const canon = canonicalPhone(row.customer_phone || '');
  if (rowPhone && variants.has(rowPhone)) return true;
  if (canon && variants.has(canon.replace(/\D/g, ''))) return true;
  const key = String(row.thread_key || '');
  return key === `p:${canonicalPhone(phone)}` || key === `p:${canon}`;
};

const readSeenAt = (phone: string) => {
  if (typeof window === 'undefined' || !phone) return 0;
  try {
    return Number(localStorage.getItem(seenKey(phone)) || 0) || 0;
  } catch {
    return 0;
  }
};

const writeSeenAt = (phone: string) => {
  if (typeof window === 'undefined' || !phone) return;
  try {
    localStorage.setItem(seenKey(phone), String(Date.now()));
  } catch {
    /* ignore */
  }
};

const countFromRows = (rows: ChatMessage[], phone: string, hasIsRead: boolean) => {
  const incoming = (rows || []).filter(isIncomingStaffChat);
  if (hasIsRead) return incoming.filter((r) => r.is_read === false).length;
  const seen = readSeenAt(phone);
  if (!seen) return 0;
  return incoming.filter((r) => new Date(r.created_at || 0).getTime() > seen).length;
};

const mapUnreadRows = (raw: any[] | null | undefined, hasIsRead: boolean): ChatMessage[] =>
  (raw || []).map((row) => {
    const mapped = mapChatMessage(row);
    if (!hasIsRead) return { ...mapped, is_read: undefined };
    return {
      ...mapped,
      is_read: typeof row?.is_read === 'boolean' ? row.is_read : false
    };
  });

export async function countUnreadCustomerChats(phone: string): Promise<number> {
  const variants = phoneVariants(phone);
  if (!variants.length) return 0;
  const withRead = await supabase
    .from('support_chats')
    .select('id, sender_type, is_internal, is_read, created_at, customer_phone, thread_key')
    .in('customer_phone', variants)
    .order('created_at', { ascending: false })
    .limit(150);
  if (!withRead.error) {
    return countFromRows(mapUnreadRows(withRead.data, true), phone, true);
  }
  if (!schemaMisses(withRead.error, 'is_read')) return 0;
  const retry = await supabase
    .from('support_chats')
    .select('id, sender_type, is_internal, created_at, customer_phone, thread_key')
    .in('customer_phone', variants)
    .order('created_at', { ascending: false })
    .limit(150);
  if (retry.error || !retry.data) return 0;
  return countFromRows(mapUnreadRows(retry.data, false), phone, false);
}

export async function markCustomerChatsRead(phone: string): Promise<void> {
  const variants = phoneVariants(phone);
  writeSeenAt(phone);
  if (!variants.length) return;
  const { error } = await supabase
    .from('support_chats')
    .update({ is_read: true })
    .in('customer_phone', variants)
    .eq('is_read', false);
  if (error && !schemaMisses(error, 'is_read')) {
    console.warn('markCustomerChatsRead:', error.message);
  }
}
