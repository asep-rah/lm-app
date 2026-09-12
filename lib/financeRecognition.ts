/**
 * Status pembayaran vs aset di laporan owner.
 *
 * | Konsep              | Field                         | Akun aset                         |
 * |---------------------|-------------------------------|-----------------------------------|
 * | Belum bayar         | pending / !is_paid            | 110002 Piutang Usaha              |
 * | Lunas gateway       | is_paid + paid_at, QRIS       | 110004 Clearing (bukan bank)      |
 * | Tunai belum setor   | Cash tanpa deposited_at       | 110005 Kas Tunai Belum Disetor    |
 * | Di rekening bank    | settled_at / deposited_at /   | 110001 Rekening Bank Outlet       |
 * |                     | MANUAL_VERIFIED (transfer)    |                                   |
 *
 * Jurnal bertanggal:
 *   created_at  → jual (Dr Piutang|KasBelumSetor / Cr Pendapatan)
 *   paid_at     → koleksi non-tunai (Dr Clearing|Bank / Cr Piutang)
 *   deposited_at/settled_at (tunai) → setor (Dr Bank / Cr KasBelumSetor)
 *   voided_at   → pembalikan bertanggal (bukan menghapus jejak bulan jual)
 *
 * BATASAN RILIS: is_paid tanpa paid_at → tetap Piutang. Backfill paid_at berbasis bukti
 * wajib sebelum menganggap saldo produksi lengkap.
 */
import { isNonCashVerifyMethod, isPaymentLocked } from '@/lib/paymentVerify';
import { isPaidTx } from '@/lib/financeRecon';
import { isVoidTransaction } from '@/lib/voidTx';

export type FinancePayKind = 'cash' | 'receivable' | 'clearing' | 'undeposited' | 'unknown';
export type FinanceAssetBucket = 'bank' | 'clearing' | 'receivable' | 'undeposited';

export function isFinanceMarkedPaid(row: any): boolean {
  return Boolean(row) && isPaidTx(row);
}

export function isFinanceNonCashMethod(row: any): boolean {
  return isNonCashVerifyMethod(row?.payment_method);
}

export function hasReliablePaidAt(row: any): boolean {
  return Boolean(row?.paid_at || row?.settled_at);
}

/** Transfer manual / settled → rekening bank. Tunai biasa → belum tentu sudah setor. */
export function isFinanceSettledToBank(row: any): boolean {
  if (!row) return false;
  if (row.settled_at || row.deposited_at) return true;
  if (isFinanceNonCashMethod(row)) {
    return String(row.paid_via || '').toUpperCase() === 'MANUAL_VERIFIED';
  }
  return false;
}

/** Bucket aset pada jurnal penjualan (created_at). */
export function saleAssetBucket(row: any): FinanceAssetBucket {
  if (isFinanceNonCashMethod(row) || isPaymentLocked(row)) return 'receivable';
  return 'undeposited'; // tunai di laci/kasir, belum rekening bank
}

/** Bucket koleksi setelah lunas non-tunai. */
export function collectionAssetBucket(row: any): FinanceAssetBucket {
  if (isFinanceSettledToBank(row)) return 'bank';
  if (isFinanceMarkedPaid(row) && isFinanceNonCashMethod(row)) return 'clearing';
  return 'clearing';
}

export function collectionDateIso(row: any): string | null {
  if (saleAssetBucket(row) !== 'receivable') return null;
  if (!isFinanceMarkedPaid(row)) return null;
  if (row.settled_at) return String(row.settled_at);
  if (row.paid_at) return String(row.paid_at);
  return null;
}

/** Setor tunai dari 110005 → 110001. */
export function cashDepositDateIso(row: any): string | null {
  if (saleAssetBucket(row) !== 'undeposited') return null;
  if (row.deposited_at) return String(row.deposited_at);
  if (row.settled_at) return String(row.settled_at);
  return null;
}

export function voidDateIso(row: any): string | null {
  if (!isVoidTransaction(row)) return null;
  if (row.voided_at) return String(row.voided_at);
  return null; // void tanpa tanggal → batasan jejak
}

export function missingPaidAtWhilePaid(row: any): boolean {
  return isFinanceMarkedPaid(row) && isFinanceNonCashMethod(row) && !hasReliablePaidAt(row);
}

export function missingVoidDate(row: any): boolean {
  return isVoidTransaction(row) && !row?.voided_at;
}

export function isFinanceCashReceived(row: any): boolean {
  if (!row) return false;
  if (saleAssetBucket(row) === 'undeposited') return true; // kas fisik ada, belum bank
  if (!isFinanceMarkedPaid(row)) return false;
  return collectionAssetBucket(row) === 'bank' && hasReliablePaidAt(row);
}

export function financePayKind(row: any): FinancePayKind {
  if (!row) return 'unknown';
  if (saleAssetBucket(row) === 'undeposited') {
    return cashDepositDateIso(row) ? 'cash' : 'undeposited';
  }
  if (!isFinanceMarkedPaid(row)) return 'receivable';
  if (!hasReliablePaidAt(row)) return 'receivable';
  if (collectionAssetBucket(row) === 'clearing') return 'clearing';
  return 'cash';
}

export function financePayLabel(kind: FinancePayKind): string {
  if (kind === 'cash') return 'Di rekening bank';
  if (kind === 'undeposited') return 'Kas tunai belum disetor';
  if (kind === 'clearing') return 'Lunas gateway (belum di rekening)';
  if (kind === 'receivable') return 'Piutang (belum lunas / tanpa paid_at)';
  return 'Status bayar belum jelas';
}

export function unpaidSalesTotal(txs: any[]): number {
  return (txs || []).reduce((s, t) => {
    if (isVoidTransaction(t)) return s;
    if (saleAssetBucket(t) !== 'receivable') return s;
    if (collectionDateIso(t)) return s;
    return s + (Number(t.amount) || 0);
  }, 0);
}

export function paidSalesTotal(txs: any[]): number {
  return (txs || []).reduce((s, t) => {
    if (isVoidTransaction(t)) return s;
    return s + (isFinanceMarkedPaid(t) ? Number(t.amount) || 0 : 0);
  }, 0);
}

export type TxReconRow = {
  id: string;
  receipt: string;
  orderAt: string;
  paidAt: string | null;
  depositedAt: string | null;
  voidedAt: string | null;
  amount: number;
  method: string;
  journals: string[];
  endingBucket: FinanceAssetBucket | 'voided' | 'revenue_only';
  endingAmount: number;
};

/**
 * Tabel per transaksi untuk menyingkirkan risiko penghitungan ganda pada total aset.
 */
export function buildTransactionReconRows(txs: any[], asOfIso?: string): TxReconRow[] {
  const asOf = asOfIso ? new Date(asOfIso).getTime() : Number.POSITIVE_INFINITY;
  const before = (iso: string | null | undefined) => {
    if (!iso) return false;
    return new Date(iso).getTime() <= asOf;
  };

  return (txs || []).map((t) => {
    const amount = Number(t.amount) || 0;
    const orderAt = String(t.created_at || '');
    const paidAt = collectionDateIso(t);
    const depositedAt = cashDepositDateIso(t);
    const voidedAt = voidDateIso(t);
    const journals: string[] = [];
    let endingBucket: TxReconRow['endingBucket'] = 'revenue_only';
    let endingAmount = 0;

    if (!before(orderAt)) {
      return {
        id: String(t.id || ''),
        receipt: String(t.receipt_number || t.id || ''),
        orderAt,
        paidAt,
        depositedAt,
        voidedAt,
        amount,
        method: String(t.payment_method || ''),
        journals: ['(di luar as-of)'],
        endingBucket: 'revenue_only',
        endingAmount: 0
      };
    }

    const saleBucket = saleAssetBucket(t);
    if (saleBucket === 'receivable') {
      journals.push(`@order Dr 110002 Piutang ${amount} / Cr Pendapatan`);
      endingBucket = 'receivable';
      endingAmount = amount;
    } else {
      journals.push(`@order Dr 110005 KasBelumSetor ${amount} / Cr Pendapatan`);
      endingBucket = 'undeposited';
      endingAmount = amount;
    }

    if (paidAt && before(paidAt) && saleBucket === 'receivable') {
      const dest = collectionAssetBucket(t);
      const code = dest === 'bank' ? '110001 Bank' : '110004 Clearing';
      journals.push(`@paid Dr ${code} ${amount} / Cr 110002 Piutang`);
      endingBucket = dest;
      endingAmount = amount;
    }

    if (depositedAt && before(depositedAt) && saleBucket === 'undeposited') {
      journals.push(`@deposit Dr 110001 Bank ${amount} / Cr 110005 KasBelumSetor`);
      endingBucket = 'bank';
      endingAmount = amount;
    }

    if (voidedAt && before(voidedAt)) {
      journals.push(`@void pembalikan bertanggal (voided_at)`);
      endingBucket = 'voided';
      endingAmount = 0;
    } else if (isVoidTransaction(t) && !voidedAt) {
      journals.push(`@void TANPA voided_at — batasan jejak`);
    }

    return {
      id: String(t.id || ''),
      receipt: String(t.receipt_number || t.id || ''),
      orderAt,
      paidAt,
      depositedAt,
      voidedAt,
      amount,
      method: String(t.payment_method || ''),
      journals,
      endingBucket,
      endingAmount
    };
  });
}

/** Usulan backfill paid_at dari bukti yang sudah ada (tidak menulis DB). */
export function proposePaidAtBackfill(row: any): {
  proposedPaidAt: string | null;
  evidence: string;
  apply: boolean;
} {
  if (!missingPaidAtWhilePaid(row)) {
    return { proposedPaidAt: null, evidence: 'tidak perlu', apply: false };
  }
  // Hanya usulkan jika ada jejak waktu non-karangan dari field yang sudah tersimpan.
  if (row.updated_at && row.is_paid === true) {
    return {
      proposedPaidAt: null,
      evidence:
        'is_paid tanpa paid_at: jangan isi dari updated_at (bisa koreksi non-bayar). Butuh bukti webhook/audit/mutasi.',
      apply: false
    };
  }
  return {
    proposedPaidAt: null,
    evidence: 'Tidak ada bukti bertanggal yang aman untuk diisi otomatis',
    apply: false
  };
}
