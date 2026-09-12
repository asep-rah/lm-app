/**
 * Status pembayaran vs aset di laporan owner.
 *
 * | Konsep           | Field                                    | Arti                                      | Akun aset                          |
 * |------------------|------------------------------------------|-------------------------------------------|------------------------------------|
 * | Belum bayar      | !is_paid, payment_status pending/menunggu| Customer belum bayar                      | 110002 Piutang Usaha               |
 * | is_paid / lunas  | is_paid / payment_status paid\|lunas     | Pembayaran terverifikasi                  | (bukan akun; picu jurnal koleksi)  |
 * | Clearing gateway | QRIS/Mayar lunas, belum di rekening      | Uang di gateway / belum masuk rek outlet  | 110004 QRIS / Gateway Clearing     |
 * | Settled di bank  | Tunai, MANUAL_VERIFIED, atau settled_at  | Sudah di rekening outlet                  | 110001 Bank Outlet                 |
 *
 * Pendapatan (PnL) tetap dari transaksi non-void pada created_at.
 * Jurnal:
 *   - created_at: tunai → Dr Bank / Cr Pendapatan; non-tunai → Dr Piutang / Cr Pendapatan
 *   - paid_at/settled_at: Dr Clearing atau Bank / Cr Piutang (hanya jika tanggal koleksi ada)
 *
 * BATASAN RILIS: is_paid tanpa paid_at tidak memindahkan piutang (agar Agustus tidak
 * berubah diam-diam). settled_at belum ada di semua baris → QRIS lunas default ke Clearing.
 */
import { isNonCashVerifyMethod, isPaymentLocked } from '@/lib/paymentVerify';
import { isPaidTx } from '@/lib/financeRecon';

export type FinancePayKind = 'cash' | 'receivable' | 'clearing' | 'unknown';
export type FinanceAssetBucket = 'bank' | 'clearing' | 'receivable';

export function isFinanceMarkedPaid(row: any): boolean {
  return Boolean(row) && isPaidTx(row);
}

export function isFinanceNonCashMethod(row: any): boolean {
  return isNonCashVerifyMethod(row?.payment_method);
}

export function hasReliablePaidAt(row: any): boolean {
  return Boolean(row?.paid_at || row?.settled_at);
}

/** Sudah dianggap masuk rekening outlet (bukan hanya lunas di gateway). */
export function isFinanceSettledToBank(row: any): boolean {
  if (!row) return false;
  if (row.settled_at) return true;
  if (!isFinanceNonCashMethod(row)) return true;
  return String(row.paid_via || '').toUpperCase() === 'MANUAL_VERIFIED';
}

/** Bucket saat penjualan (created_at). */
export function saleAssetBucket(row: any): FinanceAssetBucket {
  if (isFinanceNonCashMethod(row) || isPaymentLocked(row)) return 'receivable';
  return 'bank';
}

/** Bucket jurnal koleksi setelah lunas. */
export function collectionAssetBucket(row: any): FinanceAssetBucket {
  if (isFinanceSettledToBank(row)) return 'bank';
  if (isFinanceMarkedPaid(row) && isFinanceNonCashMethod(row)) return 'clearing';
  return 'bank';
}

/**
 * Tanggal koleksi untuk jurnal Dr Clearing|Bank / Cr Piutang.
 * null = jangan posting koleksi (pending, atau lunas tanpa paid_at).
 */
export function collectionDateIso(row: any): string | null {
  if (!isFinanceNonCashMethod(row) && !isPaymentLocked(row)) return null; // tunai: tidak ada koleksi terpisah
  if (!isFinanceMarkedPaid(row)) return null;
  if (row.settled_at) return String(row.settled_at);
  if (row.paid_at) return String(row.paid_at);
  return null;
}

export function missingPaidAtWhilePaid(row: any): boolean {
  return isFinanceMarkedPaid(row) && isFinanceNonCashMethod(row) && !hasReliablePaidAt(row);
}

/** Kompatibilitas: “kas di bank” (bukan clearing, bukan piutang). */
export function isFinanceCashReceived(row: any): boolean {
  if (!row) return false;
  if (saleAssetBucket(row) === 'bank') return true;
  if (!isFinanceMarkedPaid(row)) return false;
  return collectionAssetBucket(row) === 'bank' && hasReliablePaidAt(row);
}

export function financePayKind(row: any): FinancePayKind {
  if (!row) return 'unknown';
  if (saleAssetBucket(row) === 'bank') return 'cash';
  if (!isFinanceMarkedPaid(row)) return 'receivable';
  if (collectionAssetBucket(row) === 'clearing') return 'clearing';
  if (!hasReliablePaidAt(row)) return 'receivable'; // lunas tanpa tanggal → tetap piutang di buku
  return 'cash';
}

export function financePayLabel(kind: FinancePayKind): string {
  if (kind === 'cash') return 'Di rekening bank';
  if (kind === 'clearing') return 'Lunas gateway (belum di rekening)';
  if (kind === 'receivable') return 'Piutang (belum lunas / tanpa paid_at)';
  return 'Status bayar belum jelas';
}

export function unpaidSalesTotal(txs: any[]): number {
  return (txs || []).reduce((s, t) => {
    if (saleAssetBucket(t) === 'bank') return s;
    if (collectionDateIso(t)) return s; // sudah dikoleksi bertanggal
    return s + (Number(t.amount) || 0);
  }, 0);
}

export function paidSalesTotal(txs: any[]): number {
  return (txs || []).reduce((s, t) => s + (isFinanceMarkedPaid(t) ? Number(t.amount) || 0 : 0), 0);
}
