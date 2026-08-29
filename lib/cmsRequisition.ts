/** Status & kolom yang dipakai CMS purchase_requests. */

export const PR_STATUS = {
  PENDING: 'Pending Approval',
  APPROVED: 'Approved - Awaiting Admin Ops',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  FULFILLED: 'Fulfilled'
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
  if (s.includes('fulfil')) return false;
  return s === 'paid' || s.includes('completed');
};

export const isPrFulfilled = (row: any) =>
  String(row?.status || '').toLowerCase().includes('fulfil');

export const prQty = (row: any) => {
  if (row?.quantity != null && row.quantity !== '') return Number(row.quantity) || 0;
  const raw = row?.items;
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : [];
  const fromItems = items.reduce((s: number, i: any) => s + (Number(i?.qty ?? i?.quantity) || 0), 0);
  if (fromItems) return fromItems;
  const m = String(row?.description || row?.notes || '').match(/(\d+)\s*(pcs|kg|ltr|liter|galon|pack|unit)/i);
  return m ? Number(m[1]) : 0;
};

export const prStatusLabel = (row: any) => {
  if (isPrFulfilled(row)) return 'Fulfilled';
  if (isPrPaid(row)) return 'Paid';
  if (isPrApprovedAwaiting(row)) return 'Approved';
  if (isPrPending(row)) return 'Pending';
  if (String(row?.status || '').toLowerCase().includes('reject')) return 'Rejected';
  return String(row?.status || '—');
};

const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export const exportPurchaseRequestsCsv = (rows: any[], filename = 'pengajuan_cms') => {
  const header = [
    'Tanggal',
    'Judul',
    'Outlet',
    'Kategori',
    'Qty',
    'Budget (Rp)',
    'Status',
    'Pemohon',
    'Deskripsi'
  ];
  const lines = [header.join(',')];
  rows.forEach((r) => {
    lines.push(
      [
        r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '',
        prTitle(r),
        r.outlets?.name || r.outlet_name || '',
        r.category || '',
        prQty(r) || '',
        prAmount(r),
        prStatusLabel(r),
        prRequestedBy(r),
        prDescription(r)
      ]
        .map(csvCell)
        .join(',')
    );
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
