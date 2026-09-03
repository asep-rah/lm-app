import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { canonicalPhone } from '@/lib/csChat';
import { notifyCsPortal } from '@/lib/notifications';

const parseIssueField = (body: string, label: string) => {
  const m = String(body || '').match(new RegExp(`${label}:\\s*(.+)`, 'i'));
  return m ? m[1].trim().split('\n')[0] : '';
};

const phoneOf = (issue: any) => issue?.customer_phone || parseIssueField(issue?.description, 'HP') || '';
const resiOf = (issue: any) => issue?.receipt_number || parseIssueField(issue?.description, 'Resi') || '—';
const descriptionOf = (issue: any) => {
  const lines = String(issue?.description || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^HP:/i.test(l) &&
        !/^Resi:/i.test(l) &&
        !/^Bukti:/i.test(l) &&
        !/^Video unboxing:/i.test(l) &&
        !/^Komplain pelanggan/i.test(l)
    );
  return lines.join('\n') || issue?.description || 'Komplain pelanggan';
};

export type ComplaintTicket = {
  id: string;
  transaction_id?: string | null;
  customer_phone?: string | null;
  issue_description?: string | null;
  status?: string;
  created_at?: string;
  resolved_at?: string | null;
  outlet_issue_id?: string | null;
  pickup_id?: string | null;
  receipt_number?: string | null;
};

export const ticketDisplayId = (ticket: any) => {
  const raw = String(ticket?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return raw || '—';
};

export const ticketTitleOf = (ticket: any) => `Tiket Komplain #${ticketDisplayId(ticket)}`;

export const ticketIsOpen = (ticket: any) => String(ticket?.status || 'open').toLowerCase() !== 'resolved';

const txIdOf = (issue: any) => (issue?.transaction_id ? String(issue.transaction_id) : null);

export async function findComplaintTicket(issue: any): Promise<ComplaintTicket | null> {
  if (!issue) return null;
  if (issue.id) {
    const { data } = await supabase
      .from('complaint_tickets')
      .select('*')
      .eq('outlet_issue_id', String(issue.id))
      .order('created_at', { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  const txId = txIdOf(issue);
  if (txId) {
    const { data } = await supabase
      .from('complaint_tickets')
      .select('*')
      .eq('transaction_id', String(txId))
      .order('created_at', { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  const phone = canonicalPhone(phoneOf(issue) || '') || phoneOf(issue);
  const resi = resiOf(issue);
  if (phone && resi && resi !== '—') {
    const { data } = await supabase
      .from('complaint_tickets')
      .select('*')
      .eq('customer_phone', phone)
      .eq('receipt_number', resi)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
}

export async function ensureComplaintTicketFromIssue(issue: any): Promise<ComplaintTicket | null> {
  if (!issue) return null;
  const existing = await findComplaintTicket(issue);
  if (existing) return existing;

  const phone = canonicalPhone(phoneOf(issue) || '') || phoneOf(issue) || null;
  const desc = descriptionOf(issue);
  const txId = txIdOf(issue);
  const pickupId = issue?.pickup_id || null;
  const resi = resiOf(issue);
  const receipt = resi && resi !== '—' ? resi : null;

  const { data, error } = await insertWithFallback<ComplaintTicket>('complaint_tickets', [
    {
      transaction_id: txId ? String(txId) : null,
      customer_phone: phone,
      issue_description: desc,
      status: 'open',
      outlet_issue_id: issue.id ? String(issue.id) : null,
      pickup_id: pickupId ? String(pickupId) : null,
      receipt_number: receipt
    },
    {
      transaction_id: txId ? String(txId) : null,
      customer_phone: phone,
      issue_description: desc,
      status: 'open'
    }
  ]);
  if (error || !data?.[0]) {
    console.warn('complaint_tickets insert:', error?.message);
    return null;
  }
  const ticket = data[0];
  notifyCsPortal('cs_complaint', 'Tiket komplain baru. Buka CS Care.');
  await insertTicketMessage({
    ticketId: ticket.id,
    senderType: 'customer',
    message: desc
  });
  return ticket;
}

export async function loadTicketMessages(ticketId: string) {
  if (!ticketId) return [];
  const { data, error } = await supabase
    .from('complaint_chat_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(400);
  if (error) {
    console.warn('complaint_chat_messages:', error.message);
    return [];
  }
  return data || [];
}

export async function insertTicketMessage(opts: {
  ticketId: string;
  senderType: 'customer' | 'cs';
  message: string;
  attachmentUrl?: string | null;
}) {
  const ticketId = String(opts.ticketId || '');
  if (!ticketId) return { error: { message: 'Tiket tidak ditemukan' } };
  const text = String(opts.message || '').trim();
  const media = opts.attachmentUrl || null;
  if (!text && !media) return { error: { message: 'Pesan kosong' } };
  const body = media && text ? `${text}\n${media}` : text || media || '';

  const { data, error } = await insertWithFallback('complaint_chat_messages', [
    {
      ticket_id: ticketId,
      sender_type: opts.senderType,
      message: body,
      attachment_url: media
    },
    {
      ticket_id: ticketId,
      sender_type: opts.senderType,
      message: body
    }
  ]);
  if (error) return { error };
  return { error: null, data: data?.[0] || null };
}

export async function resolveComplaintTicket(ticketId: string) {
  const id = String(ticketId || '');
  if (!id) return { error: { message: 'Tiket tidak ditemukan' } };
  const now = new Date().toISOString();
  return updateWithFallback(
    'complaint_tickets',
    [
      { status: 'resolved', resolved_at: now },
      { status: 'resolved' }
    ],
    { column: 'id', value: id }
  );
}

export async function resolveComplaintInvestigation(opts: { issue: any; ticket?: any; agentName?: string }) {
  const issue = opts.issue || {};
  const ticket = opts.ticket || (await ensureComplaintTicketFromIssue(issue));
  if (ticket?.id) {
    await insertTicketMessage({
      ticketId: ticket.id,
      senderType: 'cs',
      message:
        'Investigasi ditutup. Tiket diselesaikan. Room chat ini akan dihapus otomatis 24 jam setelah penyelesaian.'
    });
    const { error } = await resolveComplaintTicket(ticket.id);
    if (error) return { error };
  }

  const now = new Date().toISOString();
  if (issue.id) {
    const { error } = await updateWithFallback(
      'outlet_issues',
      [
        {
          status: 'Selesai',
          workflow_step: 'resolved',
          resolved_at: now,
          assigned_to_role: 'cs_care'
        },
        { status: 'Selesai', resolved_at: now },
        { status: 'Selesai' }
      ],
      { column: 'id', value: issue.id }
    );
    if (error) return { error };
  }

  const orderRef = issue.transaction_id
    ? { id: issue.transaction_id, receipt_number: issue.receipt_number, pickup_id: issue.pickup_id }
    : issue.pickup_id
    ? { id: issue.pickup_id }
    : null;
  if (orderRef?.id) {
    const { patchOrderComplaint } = await import('@/lib/orderFeedback');
    await patchOrderComplaint(orderRef, { complaint_status: 'resolved' });
  }

  return { error: null, ticket: ticket ? { ...ticket, status: 'resolved', resolved_at: now } : null };
}
