import { supabase } from '@/lib/supabaseClient';
import { insertChatMessage } from '@/lib/csChat';
import { updateWithFallback } from '@/lib/safeWrite';
import { completeTaskWithSlaCheck } from '@/utils/taskSlaEvaluator';
import { getStaffSession } from '@/lib/staffSession';
import { patchOrderComplaint } from '@/lib/orderFeedback';

export const COMPLAINT_CATEGORY = 'Komplain Pelanggan';

export const COMPENSATION_OPTIONS = [
  { value: 'voucher', label: 'Voucher Cuci Gratis' },
  { value: 'refund_deposit', label: 'Refund ke Deposit' },
  { value: 'free_wash', label: 'Cuci Ulang Gratis' },
  { value: 'partial_refund', label: 'Refund Sebagian' },
  { value: 'other', label: 'Lainnya' }
];

const URL_RE = /https?:\/\/[^\s]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

export const isComplaintIssue = (row: any) => {
  const cat = String(row?.category || row?.title || '').toLowerCase();
  const role = String(row?.assigned_to_role || '').toLowerCase();
  const desc = String(row?.description || '').toLowerCase();
  return (
    role === 'cs_care' ||
    cat.includes('komplain') ||
    desc.includes('komplain pelanggan')
  );
};

export const parseIssueField = (body: string, label: string) => {
  const re = new RegExp(`${label}:\\s*(.+)`, 'i');
  const m = String(body || '').match(re);
  return m ? m[1].trim().split('\n')[0] : '';
};

export const issuePhotos = (issue: any): string[] => {
  const out: string[] = [];
  const push = (u: any) => {
    const s = String(u || '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(issue?.media_url);
  push(issue?.evidence_url);
  const text = `${issue?.description || ''}\n${issue?.compensation_offer || ''}`;
  (text.match(URL_RE) || []).forEach(push);
  return out;
};

export const issueResi = (issue: any) =>
  issue?.receipt_number || parseIssueField(issue?.description, 'Resi') || '—';

export const issuePhone = (issue: any) =>
  issue?.customer_phone || parseIssueField(issue?.description, 'HP') || '';

export const issueCustomerName = (issue: any) =>
  issue?.customer_name || issue?.reporter_name || issue?.created_by_name || 'Pelanggan';

export const issueOutletName = (issue: any, outlets: any[] = []) => {
  if (issue?.outlet_name) return issue.outlet_name;
  const found = outlets.find((o) => String(o.id) === String(issue?.outlet_id));
  return found?.name || '—';
};

export const issueDescriptionPlain = (issue: any) => {
  const lines = String(issue?.description || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^HP:/i.test(l) && !/^Resi:/i.test(l) && !/^Bukti:/i.test(l) && !/^Komplain pelanggan/i.test(l));
  return lines.join('\n') || issue?.description || '—';
};

export const loadCareComplaints = async () => {
  const { data, error } = await supabase
    .from('outlet_issues')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(120);
  if (error) return { data: [] as any[], error };
  return { data: (data || []).filter(isComplaintIssue), error: null };
};

export const resolveCareComplaint = async (opts: {
  issue: any;
  compensationType: string;
  compensationDetail: string;
  evidenceUrl?: string;
  agentName?: string;
}) => {
  const issue = opts.issue || {};
  const typeLabel =
    COMPENSATION_OPTIONS.find((o) => o.value === opts.compensationType)?.label || opts.compensationType;
  const offer = [typeLabel, opts.compensationDetail.trim()].filter(Boolean).join(' — ');
  const now = new Date().toISOString();

  const { error } = await updateWithFallback(
    'outlet_issues',
    [
      {
        status: 'Selesai',
        compensation_offer: offer,
        evidence_url: opts.evidenceUrl || issue.evidence_url || null,
        assigned_to_role: 'cs_care',
        resolved_at: now
      },
      {
        status: 'Selesai',
        compensation_offer: offer,
        evidence_url: opts.evidenceUrl || null
      },
      { status: 'Selesai' }
    ],
    { column: 'id', value: issue.id }
  );
  if (error) return { error };

  const phone = issuePhone(issue);
  const resi = issueResi(issue);
  if (phone) {
    await insertChatMessage({
      customer_phone: phone,
      pickup_order_id: issue.pickup_id || null,
      transaction_id: issue.transaction_id || null,
      sender_type: 'cs',
      sender_name: opts.agentName || 'CS Care',
      message: [
        `Halo Kak, komplain${resi && resi !== '—' ? ` untuk resi ${resi}` : ''} telah kami selesaikan.`,
        offer ? `Tawaran ganti rugi: ${offer}.` : '',
        'Terima kasih atas kesabarannya. Jika masih ada kendala, balas chat ini ya Kak.'
      ]
        .filter(Boolean)
        .join('\n')
    });
  }

  const orderRef = issue.transaction_id
    ? { id: issue.transaction_id, receipt_number: issue.receipt_number, pickup_id: issue.pickup_id }
    : issue.pickup_id
    ? { id: issue.pickup_id }
    : null;
  if (orderRef?.id) {
    await patchOrderComplaint(orderRef, { complaint_status: 'resolved' });
  }

  try {
    const { data: tasks } = await supabase
      .from('system_tasks')
      .select('id, status')
      .eq('source_id', issue.id);
    const agent = getStaffSession();
    for (const t of tasks || []) {
      const st = String(t.status || '').toLowerCase();
      if (st === 'completed' || st === 'done' || st === 'selesai') continue;
      await completeTaskWithSlaCheck(t.id, {
        id: agent.id || agent.name,
        name: opts.agentName || agent.name,
        role: agent.role || 'cs_care'
      });
    }
  } catch (e) {
    console.warn('cs care complete tasks:', e);
  }

  return { error: null, offer };
};
