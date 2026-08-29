import { supabase } from '@/lib/supabaseClient';

/** 08xx, 8xx, dan 62xx jadi 62… supaya thread tidak pecah. */
export const canonicalPhone = (raw: string) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8') && d.length >= 9 && d.length <= 13) d = '62' + d;
  return d;
};

export const phoneVariants = (raw: string): string[] => {
  const d = String(raw || '').replace(/\D/g, '');
  const out = new Set<string>();
  if (raw) out.add(String(raw).trim());
  if (d) out.add(d);
  const canon = canonicalPhone(raw || d);
  if (canon) {
    out.add(canon);
    out.add('+' + canon);
    if (canon.startsWith('62')) out.add('0' + canon.slice(2));
  }
  if (d.startsWith('0') && d.length > 4) {
    out.add('62' + d.slice(1));
    out.add('+62' + d.slice(1));
  }
  if (d.startsWith('62') && d.length > 4) out.add('0' + d.slice(2));
  return [...out].filter(Boolean);
};

export const threadKeyOf = (row: any): string => {
  const phone = canonicalPhone(row?.customer_phone || '');
  if (phone) return 'p:' + phone;
  if (row?.order_id) return 'o:' + row.order_id;
  if (row?.thread_key) return String(row.thread_key);
  return 'unknown';
};

export const phoneFromThread = (key: string) =>
  key.startsWith('p:') ? key.slice(2) : '';

export const isStaffOnlyMessage = (row: any) => {
  const t = String(row?.sender_type || '').toLowerCase();
  return t === 'internal' || row?.is_internal === true;
};

export const insertChatMessage = async (input: {
  customer_phone?: string | null;
  order_id?: string | null;
  pickup_order_id?: string | null;
  transaction_id?: string | null;
  sender_type: string;
  message: string;
  sender_name?: string;
  is_internal?: boolean;
  assigned_to_agent_id?: string | null;
  assigned_to_agent_name?: string | null;
  is_claimed?: boolean;
  attachment_url?: string | null;
  attachment_type?: string | null;
  image_url?: string | null;
}) => {
  const thread_key = threadKeyOf(input);
  const media = input.image_url || input.attachment_url || null;
  const isInline = Boolean(media && String(media).startsWith('data:'));
  const withFile =
    media && !isInline
      ? `${input.message || ''}${input.message ? '\n' : ''}${media}`.trim()
      : input.message;

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const asUuid = (v?: string | null) => {
    const s = String(v || '').trim();
    if (!s || /^trx-/i.test(s) || !UUID_RE.test(s)) return null;
    return s;
  };
  // order_id merujuk pickup_orders.id. Jangan pakai id transaksi / resi TRX-… (UUID transaksi tetap UUID).
  const pickupId = asUuid(input.pickup_order_id);
  const txId = asUuid(input.transaction_id);

  const base: Record<string, any> = {
    customer_phone: input.customer_phone || null,
    sender_type: input.sender_type,
    message: withFile,
    sender_name: input.sender_name || null,
    is_internal: !!input.is_internal,
    thread_key,
    assigned_to_agent_id: input.assigned_to_agent_id || null,
    assigned_to_agent_name: input.assigned_to_agent_name || null,
    is_claimed: !!input.is_claimed,
    attachment_url: media,
    image_url: media,
    attachment_type: input.attachment_type || (isInline || String(media || '').includes('image') ? 'image' : null)
  };

  const attempts = [
    { ...base, order_id: pickupId, transaction_id: txId },
    { ...base, order_id: pickupId, transaction_id: txId, assigned_to_agent_id: undefined, assigned_to_agent_name: undefined, is_claimed: undefined },
    { ...base, order_id: pickupId, assigned_to_agent_id: undefined, assigned_to_agent_name: undefined, is_claimed: undefined, attachment_url: undefined },
    { ...base, transaction_id: txId, assigned_to_agent_id: undefined, assigned_to_agent_name: undefined, is_claimed: undefined, image_url: undefined },
    {
      customer_phone: base.customer_phone,
      sender_type: input.is_internal ? 'internal' : input.sender_type,
      message: withFile,
      order_id: pickupId,
      transaction_id: txId,
      image_url: media,
      attachment_url: media
    },
    {
      customer_phone: base.customer_phone,
      sender_type: input.is_internal ? 'internal' : input.sender_type,
      message: withFile,
      transaction_id: txId
    },
    {
      customer_phone: base.customer_phone,
      sender_type: input.is_internal ? 'internal' : input.sender_type,
      message: withFile
    }
  ];

  const isCustomer =
    !input.is_internal && ['customer', 'user', 'pelanggan'].includes(String(input.sender_type || '').toLowerCase());

  // Buka ulang dulu supaya refetch realtime pertama sudah melihat antrean Unassigned.
  if (isCustomer) {
    await reopenResolvedThread({
      thread_key,
      customer_phone: input.customer_phone,
      preview: input.message
    });
  }

  let lastErr: any = null;
  let dropOrderId = false;
  let dropTxId = false;
  for (const row of attempts) {
    const next = { ...row };
    if (dropOrderId) delete next.order_id;
    if (dropTxId) delete next.transaction_id;
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== null));
    const { error } = await supabase.from('support_chats').insert([clean]);
    if (!error) return { error: null, thread_key };
    lastErr = error;
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('foreign key') || msg.includes('order_id_fkey')) dropOrderId = true;
    if (msg.includes('schema cache') && msg.includes('transaction_id')) dropTxId = true;
  }
  return { error: lastErr, thread_key };
};

const CLOSED_STATUSES = new Set(['resolved', 'closed', 'selesai', 'done']);

export const sessionLooksClosed = (session: any) => {
  if (!session) return false;
  if (session.is_resolved === true) return true;
  return CLOSED_STATUSES.has(String(session.status || '').toLowerCase().trim());
};

export const upsertChatSession = async (patch: Record<string, any>) => {
  if (!patch.thread_key) return;
  const attempts = [
    patch,
    Object.fromEntries(
      Object.entries(patch).filter(([k]) => !['status', 'waiting_since', 'updated_at'].includes(k))
    ),
    {
      thread_key: patch.thread_key,
      customer_phone: patch.customer_phone,
      assigned_to_agent_id: patch.assigned_to_agent_id,
      assigned_to_agent_name: patch.assigned_to_agent_name,
      is_claimed: patch.is_claimed,
      is_resolved: patch.is_resolved,
      last_message_at: patch.last_message_at,
      last_sender_type: patch.last_sender_type,
      last_preview: patch.last_preview,
      resolved_at: patch.resolved_at
    }
  ];
  for (const row of attempts) {
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    if (!clean.thread_key) continue;
    const { error } = await supabase.from('support_chat_sessions').upsert(clean, { onConflict: 'thread_key' });
    if (!error) return;
    lastSessionWarn(error.message);
  }
};

let lastSessionWarnAt = 0;
const lastSessionWarn = (msg: string) => {
  const now = Date.now();
  if (now - lastSessionWarnAt < 4000) return;
  lastSessionWarnAt = now;
  console.warn('support_chat_sessions:', msg);
};

/** Thread resolved/closed + pesan customer baru → kembali ke antrean Unassigned. */
export const reopenResolvedThread = async (opts: {
  thread_key: string;
  customer_phone?: string | null;
  preview?: string;
}): Promise<{ reopened: boolean }> => {
  const thread_key = String(opts.thread_key || '');
  if (!thread_key || thread_key === 'unknown') return { reopened: false };

  const { data: session } = await supabase
    .from('support_chat_sessions')
    .select('*')
    .eq('thread_key', thread_key)
    .maybeSingle();

  if (!sessionLooksClosed(session)) return { reopened: false };

  const now = new Date().toISOString();
  const phone = opts.customer_phone || session.customer_phone || phoneFromThread(thread_key) || null;

  await upsertChatSession({
    thread_key,
    customer_phone: phone,
    assigned_to_agent_id: null,
    assigned_to_agent_name: null,
    is_claimed: false,
    is_resolved: false,
    resolved_at: null,
    status: 'unassigned',
    waiting_since: now,
    updated_at: now,
    last_message_at: now,
    last_sender_type: 'customer',
    last_preview: opts.preview ? String(opts.preview).slice(0, 80) : session.last_preview
  });

  const variants = phoneVariants(phone || '');
  const patches = [
    {
      assigned_to_agent_id: null,
      assigned_to_agent_name: null,
      is_claimed: false,
      is_resolved: false,
      status: 'unassigned'
    },
    {
      assigned_to_agent_id: null,
      assigned_to_agent_name: null,
      is_claimed: false,
      is_resolved: false
    },
    { assigned_to_agent_name: null, is_claimed: false, is_resolved: false }
  ];
  for (const patch of patches) {
    let ok = false;
    if (variants.length) {
      const { error } = await supabase.from('support_chats').update(patch).in('customer_phone', variants);
      if (!error) ok = true;
    }
    if (!ok) {
      const { error } = await supabase.from('support_chats').update(patch).eq('thread_key', thread_key);
      if (!error) ok = true;
    }
    if (ok) break;
  }

  return { reopened: true };
};

/** Dipakai /api/chat: hanya tulis ke CS bila thread customer sedang resolved/closed. */
export const ingestCustomerMessageIfThreadClosed = async (phone: string, message: string) => {
  const text = String(message || '').trim();
  const customer_phone = String(phone || '').trim();
  if (!text || !customer_phone) return { ingested: false };
  const thread_key = threadKeyOf({ customer_phone });
  const { data: session } = await supabase
    .from('support_chat_sessions')
    .select('*')
    .eq('thread_key', thread_key)
    .maybeSingle();
  if (!sessionLooksClosed(session)) return { ingested: false };
  const res = await insertChatMessage({
    customer_phone,
    sender_type: 'customer',
    message: text
  });
  return { ingested: !res.error, error: res.error };
};

export const claimThread = async (
  threadKey: string,
  agent: { id: string; name: string },
  phone?: string,
  extra?: Record<string, any>
) => {
  const now = new Date().toISOString();
  await upsertChatSession({
    thread_key: threadKey,
    customer_phone: phone || phoneFromThread(threadKey) || null,
    assigned_to_agent_id: agent.id,
    assigned_to_agent_name: agent.name,
    is_claimed: true,
    is_resolved: false,
    status: 'open',
    last_message_at: now,
    waiting_since: null,
    updated_at: now,
    ...extra
  });

  const phoneDigits = phone || phoneFromThread(threadKey);
  const variants = phoneVariants(phoneDigits);
  const patch = {
    assigned_to_agent_id: agent.id,
    assigned_to_agent_name: agent.name,
    is_claimed: true
  };
  if (variants.length) {
    const { error } = await supabase.from('support_chats').update(patch).in('customer_phone', variants);
    if (error) {
      await supabase
        .from('support_chats')
        .update({ assigned_to_agent_name: agent.name, is_claimed: true })
        .in('customer_phone', variants);
    }
  }
  await supabase.from('support_chats').update(patch).eq('thread_key', threadKey);
};

export const resolveThread = async (threadKey: string, csat?: number) => {
  const now = new Date().toISOString();
  await upsertChatSession({
    thread_key: threadKey,
    is_resolved: true,
    status: 'resolved',
    resolved_at: now,
    updated_at: now,
    waiting_since: null,
    csat_score: csat ?? null
  });
};
