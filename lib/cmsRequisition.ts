/** Status & kolom yang dipakai CMS purchase_requests. */

export const PR_STATUS = {
  PENDING: 'Pending Approval',
  APPROVED: 'Approved - Awaiting Admin Ops',
  REJECTED: 'Rejected',
  PAID: 'Paid'
} as const;

export const prRequestedBy = (row: any) =>
  String(row?.requested_by || row?.requester_name || '');

export const prTitle = (row: any) =>
  String(row?.title || row?.category || 'Pengajuan Pembelian');

export const prAmount = (row: any) =>
  Number(row?.amount ?? row?.actual_cost ?? row?.estimated_cost) || 0;

export const prDescription = (row: any) =>
  String(row?.description || row?.notes || '');

export const prReceiptUrl = (row: any) =>
  String(row?.receipt_url || row?.proof_url || row?.quote_url || row?.payment_proof_url || '');

export const prApprovedAt = (row: any) =>
  row?.supervisor_approved_at || row?.approved_at || null;

export const prPaidAt = (row: any) =>
  row?.admin_paid_at || row?.paid_at || null;

export const isPrPending = (row: any) =>
  String(row?.status || '') === PR_STATUS.PENDING ||
  String(row?.status || '').toLowerCase().includes('pending');

export const isPrApprovedAwaiting = (row: any) => {
  const s = String(row?.status || '');
  return s === PR_STATUS.APPROVED || s.toLowerCase().includes('awaiting');
};

export const isPrPaid = (row: any) => {
  const s = String(row?.status || '').toLowerCase();
  return s === 'paid' || s.includes('completed');
};

/** Payload insert yang hanya berisi kolom CMS — kolom hantu menolak seluruh baris. */
export const cmsInsertPayload = (input: {
  outlet_id: string;
  requested_by: string;
  title: string;
  amount: number;
  category: string;
  description: string;
  receipt_url?: string | null;
}) => ({
  outlet_id: input.outlet_id,
  requested_by: input.requested_by,
  title: input.title,
  amount: input.amount,
  category: input.category,
  description: input.description || null,
  receipt_url: input.receipt_url || null,
  proof_url: input.receipt_url || null,
  status: PR_STATUS.PENDING
});
