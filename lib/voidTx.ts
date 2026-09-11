import { updateWithFallback } from '@/lib/safeWrite';
import { supabase } from '@/lib/supabaseClient';

/** Transaksi batal/cancel/void tidak masuk omset, ROI, atau KPI. */
export const isVoidTransaction = (
  row: { status?: unknown; delete_requested?: unknown; is_void?: unknown } | null | undefined
) => {
  if (row?.is_void === true) return true;
  if (row?.delete_requested === true) return true;
  return isCancelledOrVoided(row);
};

/**
 * Sudah di-void / dibatalkan (bukan sekadar menunggu approval hapus).
 * Dipakai filter antrian proses — permintaan hapus pending tetap tampil.
 */
export const isCancelledOrVoided = (
  row: { status?: unknown; is_void?: unknown } | null | undefined
) => {
  if (row?.is_void === true) return true;
  const s = String(row?.status || '').toLowerCase();
  return s.includes('batal') || s.includes('cancel') || s.includes('void');
};

const parseItems = (raw: unknown): any[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Soft-void: jangan hard-delete baris transaksi (jejak uang investor hilang).
 * Payload bertingkat agar kolom opsional yang belum ada di schema live tidak menggagalkan update.
 * Juga: tandai item dibatalkan, hapus jurnal cashflow terkait, batalkan pickup terkait.
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

  const { data: existing } = await supabase
    .from('transactions')
    .select('id, items, pickup_id, amount, outlet_id, receipt_number')
    .eq('id', id)
    .maybeSingle();

  const items = parseItems(existing?.items).map((it) => ({
    ...it,
    status: 'Dibatalkan'
  }));

  const baseVoid = {
    is_void: true,
    delete_requested: false,
    delete_reason: null,
    status: 'Dibatalkan',
    void_reason: reason,
    voided_at: now,
    voided_by: by
  } as Record<string, unknown>;

  const payloads: Record<string, unknown>[] = [
    items.length ? { ...baseVoid, items } : baseVoid,
    {
      is_void: true,
      delete_requested: false,
      delete_reason: null,
      status: 'Dibatalkan',
      ...(items.length ? { items } : {})
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
  ];

  const { error } = await updateWithFallback('transactions', payloads, { column: 'id', value: id });

  if (error) return { error };

  // Hapus jejak omset kas dari jurnal POS (jika ada).
  try {
    await supabase.from('cashflow_logs').delete().eq('reference_id', id);
  } catch {
    /* tabel/kolom opsional */
  }

  // Pickup terkait ikut dibatalkan agar tidak muncul di antrian.
  const pickupId = existing?.pickup_id ? String(existing.pickup_id) : '';
  if (pickupId) {
    try {
      await updateWithFallback(
        'pickup_orders',
        [{ status: 'Batal' }, { status: 'Dibatalkan' }],
        { column: 'id', value: pickupId }
      );
    } catch {
      /* ignore */
    }
  }

  // Audit table delete_requests (jika dipakai).
  try {
    await supabase.from('delete_requests').delete().eq('transaction_id', id);
  } catch {
    /* ignore */
  }

  return { error: null };
}
