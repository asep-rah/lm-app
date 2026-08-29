import { supabase } from '@/lib/supabaseClient';
import { insertChatMessage } from '@/lib/csChat';
import { updateWithFallback } from '@/lib/safeWrite';
import { completeTaskWithSlaCheck } from '@/utils/taskSlaEvaluator';
import { getStaffSession } from '@/lib/staffSession';
import { patchOrderComplaint } from '@/lib/orderFeedback';
import { createIssueTasksForRoles } from '@/lib/createOutletIssueTask';

export const COMPLAINT_CATEGORY = 'Komplain Pelanggan';

export const COMPENSATION_OPTIONS = [
  { value: 'voucher', label: 'Voucher Cuci Gratis' },
  { value: 'refund_deposit', label: 'Refund ke Deposit' },
  { value: 'free_wash', label: 'Cuci Ulang Gratis' },
  { value: 'partial_refund', label: 'Refund Sebagian' },
  { value: 'other', label: 'Lainnya' }
];

export const SUPERVISOR_DECISIONS = [
  { value: 'cash', label: 'Ganti Rugi Cash' },
  { value: 'voucher', label: 'Voucher' },
  { value: 'reject', label: 'Tolak' }
];

export type ComplaintStep =
  | 'pending_investigation'
  | 'pending_supervisor'
  | 'decision_ready'
  | 'awaiting_customer'
  | 'appealed'
  | 'resolved';

export const decisionLabelOf = (value: string) =>
  SUPERVISOR_DECISIONS.find((d) => d.value === value)?.label || value || '—';

export const complaintStepOf = (issue: any): ComplaintStep => {
  const wf = String(issue?.workflow_step || '').toLowerCase();
  const st = String(issue?.status || '').toLowerCase();
  const decided = String(issue?.supervisor_decision || '').trim();
  if (st.includes('selesai') || st.includes('resolved') || wf === 'resolved') return 'resolved';
  if (wf === 'customer' || st.includes('awaiting')) return 'awaiting_customer';
  if (wf === 'forward' || st.includes('decision')) return 'decision_ready';
  if (wf === 'supervisor' || st.includes('supervisor')) {
    return decided ? 'decision_ready' : 'pending_supervisor';
  }
  if (wf === 'appealed' || st.includes('appeal') || st.includes('banding')) return 'appealed';
  if (decided) return 'decision_ready';
  return 'pending_investigation';
};

const orderRefOf = (issue: any) =>
  issue?.transaction_id
    ? { id: issue.transaction_id, receipt_number: issue.receipt_number, pickup_id: issue.pickup_id }
    : issue?.pickup_id
    ? { id: issue.pickup_id }
    : null;

export const loadComplaintForOrder = async (order: any) => {
  if (!order) return null;
  const txId = order.receipt_number ? order.id : order.transaction_id || null;
  const pickupId = order.pickup_id || (!order.receipt_number ? order.id : null);
  const resi = String(order.receipt_number || order.order_number || '').trim();
  let q = supabase.from('outlet_issues').select('*').order('created_at', { ascending: false }).limit(8);
  if (txId) q = q.eq('transaction_id', txId);
  else if (pickupId) q = q.eq('pickup_id', pickupId);
  else if (resi) q = q.eq('receipt_number', resi);
  else return null;
  const { data } = await q;
  const rows = (data || []).filter(isComplaintIssue);
  if (rows[0]) return rows[0];
  if (resi) {
    const { data: byResi } = await supabase
      .from('outlet_issues')
      .select('*')
      .eq('receipt_number', resi)
      .order('created_at', { ascending: false })
      .limit(3);
    return (byResi || []).filter(isComplaintIssue)[0] || null;
  }
  return null;
};

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
  return out.filter((u) => !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) && !String(u).includes('video'));
};

export const issueVideo = (issue: any) =>
  issue?.unboxing_video_url ||
  parseIssueField(issue?.description, 'Video unboxing') ||
  '';

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
    .filter((l) => !/^HP:/i.test(l) && !/^Resi:/i.test(l) && !/^Bukti:/i.test(l) && !/^Video unboxing:/i.test(l) && !/^Komplain pelanggan/i.test(l));
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

export const submitFindingsToSupervisor = async (opts: {
  issue: any;
  findings: string;
  cctvNotes: string;
  evidenceUrl?: string;
  agentName?: string;
}) => {
  const issue = opts.issue || {};
  const findings = String(opts.findings || '').trim();
  if (!findings) return { error: { message: 'Isi temuan investigasi' } };
  const { error } = await updateWithFallback(
    'outlet_issues',
    [
      {
        status: 'pending_supervisor',
        workflow_step: 'supervisor',
        findings,
        cctv_notes: String(opts.cctvNotes || '').trim() || null,
        evidence_url: opts.evidenceUrl || issue.evidence_url || null,
        assigned_to_role: 'supervisor'
      },
      {
        status: 'pending_supervisor',
        findings,
        assigned_to_role: 'supervisor'
      },
      { status: 'pending_supervisor' }
    ],
    { column: 'id', value: issue.id }
  );
  if (error) return { error };

  await createIssueTasksForRoles(
    {
      id: issue.id,
      category: 'Persetujuan Komplain',
      description: findings,
      reporter_name: opts.agentName || 'CS Care',
      urgency: 'mendesak'
    },
    ['supervisor']
  );

  const orderRef = orderRefOf(issue);
  if (orderRef?.id) {
    await patchOrderComplaint(orderRef, { complaint_status: 'pending_supervisor' });
  }
  return { error: null };
};

export const supervisorDecide = async (opts: {
  issue: any;
  decision: string;
  note?: string;
  agentName?: string;
}) => {
  const issue = opts.issue || {};
  const decision = String(opts.decision || '').trim();
  if (!SUPERVISOR_DECISIONS.some((d) => d.value === decision)) {
    return { error: { message: 'Pilih Ganti Rugi Cash, Voucher, atau Tolak' } };
  }
  const { error } = await updateWithFallback(
    'outlet_issues',
    [
      {
        supervisor_decision: decision,
        supervisor_note: String(opts.note || '').trim() || null,
        status: 'decision_ready',
        workflow_step: 'forward',
        assigned_to_role: 'cs_care'
      },
      {
        supervisor_decision: decision,
        status: 'decision_ready',
        assigned_to_role: 'cs_care'
      },
      { status: 'decision_ready' }
    ],
    { column: 'id', value: issue.id }
  );
  if (error) return { error };

  const orderRef = orderRefOf(issue);
  if (orderRef?.id) {
    await patchOrderComplaint(orderRef, { complaint_status: 'decision_ready' });
  }
  return { error: null, decision };
};

export const forwardDecisionToCustomer = async (opts: { issue: any; agentName?: string }) => {
  const issue = opts.issue || {};
  const label = decisionLabelOf(issue.supervisor_decision);
  const note = String(issue.supervisor_note || '').trim();
  const { error } = await updateWithFallback(
    'outlet_issues',
    [
      {
        status: 'awaiting_customer',
        workflow_step: 'customer',
        assigned_to_role: 'cs_care'
      },
      { status: 'awaiting_customer' }
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
        `Halo Kak, hasil investigasi komplain${resi && resi !== '—' ? ` resi ${resi}` : ''} sudah diputuskan Supervisor.`,
        `Keputusan: ${label}.`,
        note ? `Catatan: ${note}` : '',
        'Silakan buka detail pesanan lalu pilih Setuju atau Banding.'
      ]
        .filter(Boolean)
        .join('\n')
    });
  }

  const orderRef = orderRefOf(issue);
  if (orderRef?.id) {
    await patchOrderComplaint(orderRef, { complaint_status: 'awaiting_customer' });
  }
  return { error: null };
};

export const customerRespondComplaint = async (opts: {
  issue: any;
  order?: any;
  agree: boolean;
}) => {
  const issue = opts.issue || {};
  if (opts.agree) {
    const mapped =
      issue.supervisor_decision === 'cash'
        ? 'partial_refund'
        : issue.supervisor_decision === 'voucher'
        ? 'voucher'
        : 'other';
    const { error } = await updateWithFallback(
      'outlet_issues',
      [
        {
          customer_decision: 'setuju',
          workflow_step: 'resolved'
        },
        { customer_decision: 'setuju' }
      ],
      { column: 'id', value: issue.id }
    );
    if (error) return { error };
    return resolveCareComplaint({
      issue: { ...issue, customer_decision: 'setuju' },
      compensationType: mapped,
      compensationDetail: [decisionLabelOf(issue.supervisor_decision), issue.supervisor_note]
        .filter(Boolean)
        .join(' — '),
      agentName: 'Pelanggan'
    });
  }

  const { error } = await updateWithFallback(
    'outlet_issues',
    [
      {
        status: 'appealed',
        workflow_step: 'investigation',
        customer_decision: 'banding',
        assigned_to_role: 'cs_care'
      },
      { status: 'appealed', assigned_to_role: 'cs_care' },
      { status: 'appealed' }
    ],
    { column: 'id', value: issue.id }
  );
  if (error) return { error };

  const phone = issuePhone(issue);
  if (phone) {
    await insertChatMessage({
      customer_phone: phone,
      pickup_order_id: issue.pickup_id || null,
      transaction_id: issue.transaction_id || null,
      sender_type: 'customer',
      sender_name: issueCustomerName(issue),
      message: 'Pelanggan mengajukan banding atas keputusan Supervisor. Mohon investigasi ulang.'
    });
  }

  const orderRef = opts.order || orderRefOf(issue);
  if (orderRef?.id) {
    await patchOrderComplaint(orderRef, { complaint_status: 'appealed' });
  }
  return { error: null };
};
