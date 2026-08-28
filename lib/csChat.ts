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
  sender_type: string;
  message: string;
  sender_name?: string;
  is_internal?: boolean;
  assigned_to_agent_id?: string | null;
  assigned_to_agent_name?: string | null;
  is_claimed?: boolean;
}) => {
  const thread_key = threadKeyOf(input);
  const full: Record<string, any> = {
    customer_phone: input.customer_phone || null,
    order_id: input.order_id || null,
    sender_type: input.sender_type,
    message: input.message,
    sender_name: input.sender_name || null,
    is_internal: !!input.is_internal,
    thread_key,
    assigned_to_agent_id: input.assigned_to_agent_id || null,
    assigned_to_agent_name: input.assigned_to_agent_name || null,
    is_claimed: !!input.is_claimed
  };

  const attempts = [
    full,
    { ...full, assigned_to_agent_id: undefined, assigned_to_agent_name: undefined, is_claimed: undefined },
    {
      customer_phone: full.customer_phone,
      order_id: full.order_id,
      sender_type: input.is_internal ? 'internal' : input.sender_type,
      message: input.message
    }
  ];

  let lastErr: any = null;
  for (const row of attempts) {
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const { error } = await supabase.from('support_chats').insert([clean]);
    if (!error) return { error: null, thread_key };
    lastErr = error;
  }
  return { error: lastErr, thread_key };
};

export const upsertChatSession = async (patch: Record<string, any>) => {
  if (!patch.thread_key) return;
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const { error } = await supabase.from('support_chat_sessions').upsert(clean, { onConflict: 'thread_key' });
  if (error) console.warn('support_chat_sessions:', error.message);
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
    last_message_at: now,
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
  await upsertChatSession({
    thread_key: threadKey,
    is_resolved: true,
    resolved_at: new Date().toISOString(),
    csat_score: csat ?? null
  });
};
