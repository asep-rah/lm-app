/**
 * How a POS / online transaction was paid, split into parts (pure).
 *
 * - 'cash'    tunai → Kas Tunai Belum Disetor (laci), harus disetor;
 * - 'noncash' QRIS / transfer → Piutang sampai lunas (paid_at) → Clearing/Bank;
 * - 'deposit' saldo deposit pelanggan. Kebijakan owner: top up deposit sudah
 *   diakui omset saat uangnya masuk, jadi pemakaian saldo BUKAN omset lagi dan
 *   tidak menambah kas.
 *
 * Split Payment disimpan POS sebagai label
 *   "Deposit Saldo (Rp 50.000) + Cash (Rp 30.000)"
 * dan dipecah dari label itu.
 */
import { isNonCashVerifyMethod } from '@/lib/paymentVerify';

export type PaymentPartKind = 'cash' | 'noncash' | 'deposit';
export type PaymentPart = { kind: PaymentPartKind; amount: number };

export const isDepositMethod = (method: unknown) => {
  const s = String(method || '').toLowerCase();
  return s.includes('deposit') || s.includes('saldo');
};

const kindOf = (method: unknown): PaymentPartKind =>
  isDepositMethod(method) ? 'deposit' : isNonCashVerifyMethod(method) ? 'noncash' : 'cash';

/** "Deposit Saldo (Rp 50.000) + Cash (Rp 30.000)" → [{method, amount}] (null when not a split label). */
export function parseSplitLabel(label: unknown): { method: string; amount: number }[] | null {
  const s = String(label || '');
  const re = /([^()+]+?)\s*\(\s*Rp\s*([\d.,]+)\s*\)/gi;
  const out: { method: string; amount: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const amount = Number(m[2].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) return null;
    out.push({ method: m[1].trim(), amount });
  }
  return out.length >= 2 ? out : null;
}

/**
 * Parts that add up exactly to the transaction amount. A split whose parts do
 * not add up to the amount (e.g. ongkir added later) is scaled; the rounding
 * remainder goes to the last part.
 */
export function paymentPartsOf(row: { amount?: unknown; payment_method?: unknown } | null | undefined): PaymentPart[] {
  const amount = Number(row?.amount) || 0;
  if (amount <= 0) return [];
  const split = parseSplitLabel(row?.payment_method);
  if (!split) return [{ kind: kindOf(row?.payment_method), amount }];
  const total = split.reduce((s, p) => s + p.amount, 0);
  if (total <= 0) return [{ kind: 'cash', amount }];
  let used = 0;
  const merged: Record<PaymentPartKind, number> = { cash: 0, noncash: 0, deposit: 0 };
  split.forEach((p, i) => {
    const part = i === split.length - 1 ? amount - used : Math.round((p.amount / total) * amount);
    used += part;
    merged[kindOf(p.method)] += part;
  });
  return (['deposit', 'noncash', 'cash'] as PaymentPartKind[])
    .filter((k) => merged[k] > 0)
    .map((k) => ({ kind: k, amount: merged[k] }));
}

/** Rupiah paid from the customer's deposit balance (not omset again). */
export const depositPaidOf = (row: { amount?: unknown; payment_method?: unknown } | null | undefined) =>
  paymentPartsOf(row)
    .filter((p) => p.kind === 'deposit')
    .reduce((s, p) => s + p.amount, 0);
