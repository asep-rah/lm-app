import { updateWithFallback } from '@/lib/safeWrite';

/** Transaksi batal/cancel/void tidak masuk omset, ROI, atau KPI. */
export const isVoidTransaction = (
  row: { status?: unknown; delete_requested?: unknown; is_void?: unknown } | null | undefined
) => {
  if (row?.is_void === true) return true;
  if (row?.delete_requested === true) return true;
  const s = String(row?.status || '').toLowerCase();
  return s.includes('batal') || s.includes('cancel') || s.includes('void');
};

/**
 * Soft-void: jangan hard-delete baris transaksi (jejak uang investor hilang).
 * Payload bertingkat agar kolom opsional yang belum ada di schema live tidak menggagalkan update.
 */
export async function softVoidTransaction(
  txId: string,
  opts?: { reason?: string; approvedBy?: string }
): Promise<{ error: { message: string } | null }> {
  const id = String(txId || '').trim();
  if (!id) return { error: { message: 'transaction id kosong' } };
  const reason = String(opts?.reason || 'Disetujui void oleh owner').slice(0, 500);
  const by = String(opts?.approvedBy || '').slice(0, 120) || null;
  const now = new Date().toISOString();
  return updateWithFallback(
    'transactions',
    [
      {
        is_void: true,
        delete_requested: false,
        delete_reason: null,
        status: 'Dibatalkan',
        void_reason: reason,
        voided_at: now,
        voided_by: by
      },
      {
        is_void: true,
        delete_requested: false,
        delete_reason: null,
        status: 'Dibatalkan'
      },
      {
        is_void: true,
        delete_requested: false,
        status: 'Dibatalkan'
      },
      {
        status: 'Dibatalkan',
        delete_requested: false,
        delete_reason: null
      }
    ],
    { column: 'id', value: id }
  );
}
