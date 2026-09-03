import { sessionLooksClosed, threadKeyOf } from '@/lib/csChat';
import { complaintStepOf, isComplaintIssue } from '@/lib/csCare';

export const CS_PORTAL_ROLES = ['cs', 'head_cs', 'cs_care'];

export const isPendingPickup = (p: any) => {
  const st = String(p?.status || '').toLowerCase();
  if (st.includes('selesai') || st.includes('diantar') || st.includes('terkirim') || st.includes('delivered') || st.includes('batal')) {
    return false;
  }
  const normalized = st.replace(/\s+/g, '_');
  const baruMasuk = normalized.includes('baru_masuk') || st.includes('baru');
  const waitingDriver =
    !String(p?.driver_name || '').trim() &&
    (st.includes('menunggu') || st.includes('request') || st.includes('kurir') || st.includes('jemput') || !st);
  return baruMasuk || waitingDriver;
};

export const isOpenComplaint = (row: any) => {
  if (!row) return false;
  const ticketStatus = String(row.status || '').toLowerCase();
  if (ticketStatus === 'open' || ticketStatus === 'urgent' || ticketStatus === 'pending') {
    if (row.issue_description || row.outlet_issue_id || row.transaction_id) return true;
  }
  if (!isComplaintIssue(row)) return false;
  return complaintStepOf(row) !== 'resolved';
};

export const unreadChatCountOf = (sessions: any[]) => {
  const keys = new Set<string>();
  for (const s of sessions || []) {
    if (sessionLooksClosed(s)) continue;
    const unassigned = !s.is_claimed || String(s.status || '').toLowerCase() === 'unassigned';
    const unread = String(s.last_sender_type || '').toLowerCase() === 'customer';
    if (unassigned || unread) keys.add(threadKeyOf(s) || String(s.thread_key || s.id || ''));
  }
  return [...keys].filter((k) => k && k !== 'unknown').length;
};
