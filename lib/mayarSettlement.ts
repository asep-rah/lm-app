/** Cocokkan settlement Mayar (balance history / webhook) ke tagihan POS. */

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
  [key: string]: unknown;
};

export type MayarClaimMatch = {
  settlementId: string;
  transactionId: string;
  via: 'payment_link_tx' | 'active_window' | 'receipt' | 'webhook_history' | 'sole_pending';
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

export function mayarGrossPaid(row: MayarSettlementRow): number {
  const credit = Math.round(Number(row?.credit ?? row?.amount ?? 0) || 0);
  const fees = feeSum(row);
  if (credit <= 0) return 0;
  return credit + fees;
}

function rowMatchesAmount(row: MayarSettlementRow, target: number): boolean {
  const credit = Math.round(Number(row.credit ?? row.amount ?? 0) || 0);
  const fees = feeSum(row);
  const gross = credit + fees;
  if (credit <= 0 && gross <= 0) return false;
  if (Math.abs(gross - target) <= 5 || Math.abs(credit - target) <= 5) return true;
  // MDR tanpa daftar fee: credit di bawah nominal
  if (fees === 0 && credit > 0 && credit <= target && target - credit <= Math.max(250, Math.round(target * 0.03))) {
    return true;
  }
  return false;
}

function isQrisLike(row: MayarSettlementRow): boolean {
  const method = String(row?.paymentMethod || '').toLowerCase();
  const type = String(row?.balanceHistoryType || '').toLowerCase();
  if (/gratis|free|saas/i.test(method)) return false;
  if (!method) return true;
  return /qris|qr|ewallet|e-wallet|gopay|ovo|dana|shopee|payme|xendit/i.test(method) || /payme|qris/i.test(type);
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

async function fetchMayarJson(apiKey: string, url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/** Ambil transaksi lunas Mayar (settled + paid — settlement QRIS kadang status paid dulu). */
export async function fetchMayarSettledRows(
  apiKey: string,
  opts?: { limit?: number; dateFromMs?: number }
): Promise<MayarSettlementRow[]> {
  if (!apiKey) return [];
  const limit = Math.min(50, Math.max(10, opts?.limit || 50));
  const urls: string[] = [];
  for (const status of ['paid', 'settled']) {
    const qs = new URLSearchParams({ limit: String(limit), status });
    if (opts?.dateFromMs && opts.dateFromMs > 0) qs.set('dateFrom', String(opts.dateFromMs));
    urls.push(`https://api.mayar.id/hl/v2/transactions?${qs.toString()}`);
  }
  urls.push(`https://api.mayar.id/hl/v2/transactions?limit=${limit}&status=settled`);
  urls.push(`https://api.mayar.id/hl/v2/transactions?limit=${limit}`);
  urls.push(`https://api.mayar.id/hl/v1/transactions?page=1&pageSize=${limit}`);

  const merged = new Map<string, MayarSettlementRow>();
  for (const url of urls) {
    const json = await fetchMayarJson(apiKey, url);
    if (!json) continue;
    const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    for (const row of rows as MayarSettlementRow[]) {
      const key = settlementRefIds(row)[0] || JSON.stringify(row).slice(0, 80);
      if (!merged.has(key)) merged.set(key, row);
    }
    if (merged.size >= 10) break;
  }
  return Array.from(merged.values());
}

/** Baca webhook history Mayar (payment.received) — fallback jika list settlement belum muncul. */
export async function fetchMayarWebhookPaidEvents(
  apiKey: string,
  opts: { amount: number; txCreatedAt?: string; limit?: number }
): Promise<Array<{ id: string; amount: number; createdMs: number; receipt?: string }>> {
  if (!apiKey) return [];
  const limit = Math.min(40, opts.limit || 25);
  const json = await fetchMayarJson(
    apiKey,
    `https://api.mayar.id/hl/v2/webhooks/new-history?limit=${limit}`
  );
  if (!json) return [];
  const rows = Array.isArray(json?.data) ? json.data : [];
  const txTs = opts.txCreatedAt ? new Date(opts.txCreatedAt).getTime() : Date.now() - 3600_000;
  const target = Math.round(Number(opts.amount) || 0);
  const out: Array<{ id: string; amount: number; createdMs: number; receipt?: string }> = [];

  for (const row of rows) {
    const type = String(row?.type || row?.event || '').toLowerCase();
    if (type && !type.includes('payment.received') && !type.includes('payment.success') && !type.includes('payment.paid')) {
      continue;
    }
    let payload: any = row?.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    const data = payload?.data || payload || {};
    const event = String(payload?.event || type || '').toLowerCase();
    if (event && !event.includes('payment.received') && !event.includes('payment.success') && !event.includes('paid')) {
      // baris history tanpa type jelas: tetap cek amount
      if (!event.includes('payment')) continue;
    }
    const amount = Math.round(Number(data?.amount || data?.paymentLinkAmount || 0) || 0);
    if (amount > 0 && Math.abs(amount - target) > 5) continue;
    const id = String(
      row?.paymentLinkTransactionId || data?.transactionId || data?.id || row?.id || ''
    ).trim();
    if (!id) continue;
    const createdMs =
      Date.parse(String(row?.createdAt || '')) ||
      Date.parse(String(data?.updatedAt || data?.createdAt || '')) ||
      Date.now();
    if (createdMs < txTs - 120_000) continue;
    const blob = [
      data?.productName,
      data?.description,
      data?.note,
      data?.customerName
    ]
      .map((v) => String(v || ''))
      .join(' ');
    const receipt = (blob.match(/TRX-[A-Z0-9-]+/i) || [])[0];
    out.push({ id, amount: amount || target, createdMs, receipt });
  }
  return out;
}

export async function fetchMayarTransactionDetail(apiKey: string, id: string): Promise<any | null> {
  if (!apiKey || !id || /^(mock_|qris_|pos_)/i.test(id)) return null;
  const urls = [
    `https://api.mayar.id/hl/v2/transactions/${encodeURIComponent(id)}`,
    `https://api.mayar.id/hl/v1/payment/${encodeURIComponent(id)}`,
    `https://api.mayar.id/hl/v2/payments/${encodeURIComponent(id)}`
  ];
  for (const url of urls) {
    const json = await fetchMayarJson(apiKey, url);
    if (json) return json;
  }
  return null;
}

export type PendingSibling = { id: string; created_at: string };

/**
 * Klaim settlement untuk tagihan ini.
 * - ID payment-link / transaction match
 * - Resi di teks Mayar
 * - Nominal + QR aktif (sibling)
 * - Jika hanya 1 pending / sibling kosong: sole_pending (aman untuk kasir tunggal)
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
      return { row, createdMs, refs };
    })
    .filter((c) => c.refs.length > 0)
    .filter((c) => !c.createdMs || c.createdMs >= txTs - 120_000)
    .filter((c) => !c.createdMs || c.createdMs <= Date.now() + 120_000)
    .filter((c) => !c.refs.some((id) => opts.usedIds.has(id)));

  if (paymentId && !/^(mock_|qris_|pos_)/i.test(paymentId)) {
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
      const blob = [
        c.row.paymentLink?.name,
        c.row.customer?.name,
        (c.row as any).description,
        (c.row as any).note,
        (c.row as any).productName,
        (c.row as any).merchantRef
      ]
        .map((v) => String(v || ''))
        .join(' ')
        .toUpperCase();
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

  let siblings = (opts.siblings || [])
    .map((s) => ({ id: s.id, ts: new Date(s.created_at).getTime() || 0 }))
    .filter((s) => s.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  // Pastikan tx ini ada di daftar sibling
  if (!siblings.some((s) => s.id === opts.txId) && opts.txCreatedAt) {
    siblings = [...siblings, { id: opts.txId, ts: txTs }].sort((a, b) => a.ts - b.ts);
  }

  const amountHits = candidates
    .filter((c) => rowMatchesAmount(c.row, target))
    .sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));

  // Satu pending saja (atau sibling hanya tx ini) → klaim settlement paling awal setelah QR dibuat
  const onlyThis =
    siblings.length === 0 || (siblings.length === 1 && siblings[0].id === opts.txId);
  if (onlyThis && amountHits[0]) {
    const hit = amountHits[0];
    return {
      settlementId: hit.refs[0],
      transactionId: String(hit.row.paymentLinkTransactionId || hit.row.transactionId || hit.refs[0]),
      via: 'sole_pending'
    };
  }

  for (const hit of amountHits) {
    const payTs = hit.createdMs || Date.now();
    const openBeforePay = siblings.filter((s) => s.ts <= payTs + 30_000);
    const owner = openBeforePay.length ? openBeforePay[openBeforePay.length - 1] : null;
    if (owner && owner.id === opts.txId) {
      return {
        settlementId: hit.refs[0],
        transactionId: String(hit.row.paymentLinkTransactionId || hit.row.transactionId || hit.refs[0]),
        via: 'active_window'
      };
    }
  }

  return null;
}
