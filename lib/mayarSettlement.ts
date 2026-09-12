/** Cocokkan settlement Mayar (balance history) ke tagihan POS tanpa false-paid. */

export type MayarSettlementRow = {
  id?: string;
  transactionId?: string;
  paymentLinkTransactionId?: string;
  credit?: number;
  amount?: number;
  status?: string;
  paymentMethod?: string;
  balanceHistoryType?: string;
  createdAt?: number | string;
  fee?: Array<{ debit?: number; balanceHistoryType?: string }>;
  paymentLink?: { id?: string; name?: string };
  customer?: { mobile?: string; name?: string };
};

export type MayarClaimMatch = {
  settlementId: string;
  transactionId: string;
  via: 'payment_link_tx' | 'active_window' | 'receipt';
};

function rowCreatedMs(row: MayarSettlementRow): number {
  const created = Number(row?.createdAt || 0);
  if (created > 1e12) return created;
  if (created > 1e9) return created * 1000;
  return Date.parse(String(row?.createdAt || '')) || 0;
}

function feeSum(row: MayarSettlementRow): number {
  if (!Array.isArray(row?.fee)) return 0;
  return row.fee.reduce((s, f) => s + Math.round(Number(f?.debit || 0) || 0), 0);
}

/** Nominal yang dibayar customer ≈ credit (net merchant) + fee. */
export function mayarGrossPaid(row: MayarSettlementRow): number {
  const credit = Math.round(Number(row?.credit ?? row?.amount ?? 0) || 0);
  const fees = feeSum(row);
  if (credit <= 0) return 0;
  return credit + fees;
}

function amountsClose(a: number, b: number, tol = 2): boolean {
  return Math.abs(a - b) <= tol;
}

function rowMatchesAmount(row: MayarSettlementRow, target: number): boolean {
  const credit = Math.round(Number(row.credit ?? row.amount ?? 0) || 0);
  const fees = feeSum(row);
  const gross = credit + fees;
  if (credit <= 0 && gross <= 0) return false;
  if (amountsClose(gross, target) || amountsClose(credit, target)) return true;
  // Fee array kosong tapi MDR sudah dipotong dari credit
  if (fees === 0 && credit > 0 && credit < target && target - credit <= 200) return true;
  return false;
}

function isQrisLike(row: MayarSettlementRow): boolean {
  const method = String(row?.paymentMethod || '').toLowerCase();
  if (!method) return true;
  return /qris|qr|ewallet|e-wallet|gopay|ovo|dana|shopee|payme|xendit/i.test(method);
}

function isSettled(row: MayarSettlementRow): boolean {
  const st = String(row?.status || '').toLowerCase();
  return !st || ['settled', 'paid', 'success', 'lunas', 'completed'].includes(st);
}

export function settlementRefIds(row: MayarSettlementRow): string[] {
  return [
    String(row?.id || '').trim(),
    String(row?.transactionId || '').trim(),
    String(row?.paymentLinkTransactionId || '').trim()
  ].filter(Boolean);
}

export async function fetchMayarSettledRows(
  apiKey: string,
  opts?: { limit?: number; dateFromMs?: number }
): Promise<MayarSettlementRow[]> {
  if (!apiKey) return [];
  const limit = Math.min(50, Math.max(10, opts?.limit || 40));
  const attempts: string[] = [];
  const qs = new URLSearchParams({ limit: String(limit), status: 'settled' });
  if (opts?.dateFromMs && opts.dateFromMs > 0) {
    qs.set('dateFrom', String(opts.dateFromMs));
    attempts.push(`https://api.mayar.id/hl/v2/transactions?${qs.toString()}`);
  }
  attempts.push(`https://api.mayar.id/hl/v2/transactions?limit=${limit}&status=settled`);
  attempts.push(`https://api.mayar.id/hl/v1/transactions?page=1&pageSize=${limit}`);

  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      });
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      if (rows.length) return rows as MayarSettlementRow[];
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function fetchMayarTransactionDetail(apiKey: string, id: string): Promise<any | null> {
  if (!apiKey || !id || id.startsWith('mock_')) return null;
  const urls = [
    `https://api.mayar.id/hl/v2/transactions/${encodeURIComponent(id)}`,
    `https://api.mayar.id/hl/v1/payment/${encodeURIComponent(id)}`,
    `https://api.mayar.id/hl/v2/payments/${encodeURIComponent(id)}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      /* try next */
    }
  }
  return null;
}

export type PendingSibling = { id: string; created_at: string };

/**
 * Klaim settlement untuk tagihan ini.
 * Aturan "QR aktif": settlement S milik pending QRIS nominal sama yang
 * paling baru dibuat sebelum S (bukan transaksi lama / bukan pencurian antar kasir).
 */
export function pickMayarSettlementForInvoice(
  rows: MayarSettlementRow[],
  opts: {
    txId: string;
    amount: number;
    txCreatedAt?: string;
    paymentId?: string;
    receipt?: string;
    usedIds: Set<string>;
    /** Pending QRIS outlet dengan nominal sama (termasuk tx ini). */
    siblings: PendingSibling[];
  }
): MayarClaimMatch | null {
  const target = Math.round(Number(opts.amount) || 0);
  if (target < 1000) return null;
  const txTs = opts.txCreatedAt ? new Date(opts.txCreatedAt).getTime() : Date.now();
  const paymentId = String(opts.paymentId || '').trim();
  const receipt = String(opts.receipt || '').trim().toUpperCase();

  const candidates = rows
    .filter((row) => isSettled(row) && isQrisLike(row))
    .map((row) => {
      const createdMs = rowCreatedMs(row);
      const refs = settlementRefIds(row);
      const gross = mayarGrossPaid(row);
      const credit = Math.round(Number(row.credit ?? row.amount ?? 0) || 0);
      return { row, createdMs, refs, gross, credit };
    })
    .filter((c) => c.refs.length > 0)
    .filter((c) => !c.createdMs || c.createdMs >= txTs - 90_000)
    .filter((c) => !c.createdMs || c.createdMs <= Date.now() + 60_000)
    .filter((c) => !c.refs.some((id) => opts.usedIds.has(id)));

  if (paymentId && !paymentId.startsWith('mock_')) {
    const byId = candidates.find((c) => c.refs.includes(paymentId));
    if (byId) {
      return {
        settlementId: byId.refs[0],
        transactionId: String(byId.row.paymentLinkTransactionId || byId.row.transactionId || byId.refs[0]),
        via: 'payment_link_tx'
      };
    }
  }

  if (receipt) {
    const byResi = candidates.find((c) => {
      const blob = `${c.row.paymentLink?.name || ''} ${c.row.customer?.name || ''}`.toUpperCase();
      if (!blob.includes(receipt)) return false;
      return rowMatchesAmount(c.row, target);
    });
    if (byResi) {
      return {
        settlementId: byResi.refs[0],
        transactionId: String(byResi.row.paymentLinkTransactionId || byResi.row.transactionId || byResi.refs[0]),
        via: 'receipt'
      };
    }
  }

  const siblings = (opts.siblings || [])
    .map((s) => ({ id: s.id, ts: new Date(s.created_at).getTime() || 0 }))
    .filter((s) => s.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  const amountHits = candidates
    .filter((c) => rowMatchesAmount(c.row, target))
    .sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));

  for (const hit of amountHits) {
    const payTs = hit.createdMs || Date.now();
    // QR "aktif" saat bayar = pending nominal sama yang paling baru dibuat sebelum/saat bayar.
    const openBeforePay = siblings.filter((s) => s.ts <= payTs + 15_000);
    const owner = openBeforePay.length ? openBeforePay[openBeforePay.length - 1] : null;
    if (owner && owner.id === opts.txId) {
      return {
        settlementId: hit.refs[0],
        transactionId: String(hit.row.paymentLinkTransactionId || hit.row.transactionId || hit.refs[0]),
        via: 'active_window'
      };
    }
    // Satu-satunya pending → boleh klaim
    if (siblings.length === 1 && siblings[0].id === opts.txId) {
      return {
        settlementId: hit.refs[0],
        transactionId: String(hit.row.paymentLinkTransactionId || hit.row.transactionId || hit.refs[0]),
        via: 'active_window'
      };
    }
  }

  return null;
}
