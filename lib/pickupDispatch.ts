import { supabase } from '@/lib/supabaseClient';
import { buildOrderErrorReport, classifyOrderError } from '@/lib/orderErrorReport';

const schemaMissesColumn = (err: { message?: string } | null | undefined, column: string) => {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('schema cache') && msg.includes(column.toLowerCase());
};

/**
 * Pesan ramah pelanggan untuk kegagalan membuat pesanan. Detail teknis (pesan
 * error Postgres asli) TIDAK PERNAH ditampilkan ke pelanggan — kirim lewat
 * reportPickupOrderError() supaya tetap bisa diperiksa di Diagnosa Sistem.
 */
export const friendlyPickupOrderError = (raw?: string | null): string => {
  switch (classifyOrderError(raw)) {
    case 'not_null':
      return 'Ada data pesanan yang belum lengkap. Periksa kembali alamat, jadwal penjemputan, dan layanan, lalu coba kirim lagi.';
    case 'network':
      return 'Koneksi internet bermasalah. Periksa jaringan Anda, lalu coba lagi.';
    case 'duplicate':
      return 'Pesanan ini sepertinya sudah tersimpan. Cek tab Aktivitas sebelum memesan ulang.';
    default:
      return 'Pesanan gagal disimpan. Coba lagi dalam beberapa saat, atau hubungi Live Chat bila terus terjadi.';
  }
};

/**
 * Kirim ringkasan error teknis (kategori, nama kolom, pesan tanpa data
 * pribadi, jumlah baris) ke error_logs lewat API — best-effort, tidak pernah
 * melempar. Payload pesanan TIDAK dikirim.
 */
export async function reportPickupOrderError(
  rawMessage: string | null | undefined,
  ctx: { isFuturePickup?: boolean; kiloanLines?: number; satuanLines?: number } = {}
): Promise<void> {
  try {
    await fetch('/api/customer/order/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOrderErrorReport(rawMessage, ctx))
    });
  } catch {
    /* best-effort: kegagalan logging tidak boleh mengganggu alur pelanggan */
  }
}

export async function findPickupIdByTransaction(txId: string): Promise<string | null> {
  if (!txId) return null;
  try {
    const { data, error } = await supabase
      .from('pickup_orders')
      .select('id')
      .eq('transaction_id', txId)
      .limit(1);
    if (error) {
      if (schemaMissesColumn(error, 'transaction_id')) return null;
      return null;
    }
    return data?.[0]?.id || null;
  } catch {
    return null;
  }
}

/**
 * Status Siap Diantar + kartu pickup_orders untuk Portal Driver — dikerjakan
 * SERVER (/api/customer/delivery-request, lib/deliveryRequestServer): hanya
 * untuk pesanan milik nomor yang masuk, sekali saja, plus tugas driver/CS/Admin
 * Ops. Browser tidak lagi menulis pickup_orders.
 */
export async function requestDriverDelivery(opts: {
  order: any;
  customerName?: string;
  customerPhone: string;
  customerAddress?: string;
  selectedOutlet?: string;
}): Promise<{ error: { message: string } | null; pickupId?: string | null }> {
  const order = opts.order || {};
  try {
    const res = await fetch('/api/customer/delivery-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        kind: order.receipt_number ? 'transaction' : 'pickup',
        orderId: order.id,
        customerPhone: opts.customerPhone,
        customerName: opts.customerName || order.customer_name,
        address: opts.customerAddress || order.address || '',
        outletId: order.outlet_id || opts.selectedOutlet || null
      })
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { error: { message: String(out?.error || `HTTP ${res.status}`) } };
    return { error: null, pickupId: out?.pickupId ?? null };
  } catch (e) {
    return { error: { message: String((e as Error)?.message || 'Failed to fetch') } };
  }
}
