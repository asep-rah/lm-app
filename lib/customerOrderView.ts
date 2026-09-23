/* eslint-disable @typescript-eslint/no-explicit-any -- order/transaction rows are untyped across the app (same as stageTimeline, posQueue). */
/**
 * Customer-facing view model of an order/transaction: laundry progress
 * (operational) kept separate from payment state, a short service summary and
 * a price breakdown that reproduces the POS receipt arithmetic.
 *
 * Pure functions only — shared rules come from stageTimeline / paymentVerify /
 * kiloanPrice; nothing here invents a status or a price rule.
 */
import { buildStageTimeline, isOrderPaid, stageKeyOf, type WorkLogRow } from '@/lib/stageTimeline';
import { isPaymentLocked } from '@/lib/paymentVerify';
import { displayItemAmount } from '@/lib/kiloanPrice';
import { parseOrderItems } from '@/lib/posQueue';

/** Row came from `transactions` (POS nota) rather than a pickup request only. */
export const isTransactionRow = (order: any) => Boolean(String(order?.receipt_number || '').trim());

const isCancelled = (order: any) => {
  const st = String(order?.status || '').toLowerCase();
  return st.includes('batal') || st.includes('cancel') || st.includes('void') || order?.is_void === true;
};

const PROGRESS_LABEL: Record<string, string> = {
  jemput: 'Menunggu penjemputan',
  outlet: 'Diterima outlet',
  sortir: 'Sedang disortir',
  cuci: 'Sedang dicuci',
  kering: 'Sedang dikeringkan',
  setrika: 'Sedang disetrika',
  packing: 'Sedang dikemas',
  siap: 'Siap diambil / diantar',
  selesai: 'Selesai'
};

export type CustomerProgress = {
  key: string;
  label: string;
  /** Completed operational steps (payment step excluded). */
  done: number;
  total: number;
};

/**
 * Laundry progress for the customer. Uses the same timeline as the detail modal
 * (buildStageTimeline, variant 'customer') but ignores the payment step so a
 * status like "Sudah Dibayar" never masquerades as washing progress.
 */
export const customerProgressOf = (order: any, logs?: WorkLogRow[] | null): CustomerProgress => {
  if (isCancelled(order)) return { key: 'batal', label: 'Dibatalkan', done: 0, total: 0 };
  // A POS nota exists only once the laundry is at the outlet, so pickup/outlet
  // steps are complete for transactions even without an explicit work log.
  const atOutlet = isTransactionRow(order);
  const timeline = buildStageTimeline(logs || [], order, { variant: 'customer' })
    .filter((s) => s.key !== 'pembayaran')
    .map((s) => (atOutlet && (s.key === 'jemput' || s.key === 'outlet') ? { ...s, done: true } : s));
  const total = timeline.length;
  const done = timeline.filter((s) => s.done).length;
  const current = timeline.find((s) => !s.done);
  const raw = String(order?.status || '').toLowerCase();
  if (!current) return { key: 'selesai', label: PROGRESS_LABEL.selesai, done, total };
  if (current.key === 'jemput') {
    if (raw.includes('terjadwal')) return { key: 'jemput', label: 'Jemput terjadwal', done, total };
    if (raw.includes('menuju')) return { key: 'jemput', label: 'Driver menuju lokasi', done, total };
  }
  if (current.key === 'outlet') {
    return { key: 'outlet', label: stageKeyOf(order?.status) === 'jemput' ? 'Dibawa ke outlet' : 'Menuju outlet', done, total };
  }
  if (current.key === 'selesai' && (raw.includes('antar') || raw.includes('delivery'))) {
    return { key: 'selesai', label: 'Sedang diantar', done, total };
  }
  if (current.key === 'selesai') return { key: 'siap', label: PROGRESS_LABEL.siap, done, total };
  return { key: current.key, label: PROGRESS_LABEL[current.key] || current.label, done, total };
};

export type CustomerPaymentBadge = { tone: 'paid' | 'pending' | 'estimate' | 'unpaid'; label: string };

/** Payment state only — independent from laundry progress. */
export const customerPaymentOf = (order: any): CustomerPaymentBadge => {
  if (isOrderPaid(order)) return { tone: 'paid', label: 'Lunas' };
  if (!isTransactionRow(order)) return { tone: 'estimate', label: 'Tagihan setelah ditimbang' };
  if (isPaymentLocked(order)) return { tone: 'pending', label: 'Menunggu pembayaran' };
  return { tone: 'unpaid', label: 'Belum lunas' };
};

/** "Cuci Kering Lipat 3 Kg + 1 item" style summary from items, else service_type. */
export const serviceSummaryOf = (order: any): string => {
  const items = parseOrderItems(order?.items);
  if (items.length) {
    const first = items[0] || {};
    const name = String(first.name || first.service_type || order?.service_type || 'Laundry');
    const kg = Number(first.weight ?? first.kg) || (String(first.type || '').toLowerCase() === 'kg' ? Number(first.qty) || 0 : 0);
    const qty = Number(first.qty) || 0;
    const qtyLabel = kg > 0 ? ` ${kg} Kg` : qty > 0 ? ` ×${qty}` : '';
    const more = items.length > 1 ? ` + ${items.length - 1} item` : '';
    return `${name}${qtyLabel}${more}`;
  }
  return String(order?.service_type || 'Laundry');
};

const parseRupiah = (raw: string) => Number(String(raw || '').replace(/[^\d]/g, '')) || 0;

export type PriceLine = { label: string; amount: number };

export type PriceBreakdown = {
  /** true = still an estimate (pickup request not yet weighed/billed at outlet). */
  isEstimate: boolean;
  items: Array<{ name: string; detail: string; amount: number }>;
  itemsTotal: number;
  subtotal: number;
  discounts: PriceLine[];
  deliveryFee: number;
  total: number;
  /** Promo applied to the ongkir only (already reflected in deliveryFee). */
  promoNote?: string;
};

/**
 * Transactions: identical arithmetic to the POS receipt and finance recon —
 *   subtotal = amount + discount_amount − delivery_fee, total = amount.
 * POS folds a loyalty redemption into discount_amount; the manual discount part
 * is re-derived from discount_type/discount_value exactly like POS computes it,
 * and any remainder is shown as "Potongan poin loyalty".
 *
 * Pickup requests (not yet a nota): values from the order form (estimate).
 */
export const priceBreakdownOf = (order: any): PriceBreakdown => {
  const rawItems = parseOrderItems(order?.items);
  const items = rawItems.map((it: any) => {
    const kg = Number(it?.weight ?? it?.kg) || 0;
    const qty = Number(it?.qty) || 0;
    const detail = [kg ? `${kg} Kg` : '', !kg && qty ? `${qty} Pcs` : '', it?.duration ? String(it.duration) : '']
      .filter(Boolean)
      .join(' · ');
    return { name: String(it?.name || it?.service_type || 'Item cucian'), detail, amount: displayItemAmount(it) };
  });
  const itemsTotal = items.reduce((s, i) => s + i.amount, 0);
  const deliveryFee = Math.max(0, Math.round(Number(order?.delivery_fee) || 0));

  if (isTransactionRow(order)) {
    const total = Math.max(0, Math.round(Number(order?.amount ?? order?.total_amount) || 0));
    const discount = Math.max(0, Math.round(Number(order?.discount_amount) || 0));
    const subtotal = Math.max(0, total + discount - deliveryFee);
    const discounts: PriceLine[] = [];
    if (discount > 0) {
      const type = String(order?.discount_type || '').toLowerCase();
      const value = Number(order?.discount_value) || 0;
      const manual = value > 0 ? (type.includes('percent') ? Math.round((subtotal * value) / 100) : Math.round(value)) : 0;
      const loyalty = discount - manual;
      if (manual > 0 && loyalty >= 0) {
        discounts.push({ label: type.includes('percent') ? `Diskon ${value}%` : 'Diskon', amount: manual });
        if (loyalty > 0) discounts.push({ label: 'Potongan poin loyalty', amount: loyalty });
      } else {
        discounts.push({ label: 'Diskon / potongan', amount: discount });
      }
    }
    return { isEstimate: false, items, itemsTotal, subtotal, discounts, deliveryFee, total };
  }

  // Pickup request: the form wrote "Promo: …", "Poin loyalty: -Rp …" and
  // "Est. Tagihan: Rp …" into notes; delivery_fee is the ongkir after promo.
  const notes = String(order?.notes || '');
  const estMatch = notes.match(/Est\.\s*Tagihan:\s*Rp\s*([\d.,]+)/i);
  const promoMatch = notes.match(/Promo:\s*([^|]+)/i);
  const loyaltyMatch = notes.match(/Poin loyalty:\s*-\s*Rp\s*([\d.,]+)/i);
  const subtotal = itemsTotal;
  const total = estMatch ? parseRupiah(estMatch[1]) : subtotal + deliveryFee;
  const loyalty = loyaltyMatch ? parseRupiah(loyaltyMatch[1]) : 0;
  const discounts: PriceLine[] = [];
  const promoAmount = Math.max(0, subtotal + deliveryFee - loyalty - total);
  if (promoMatch && promoAmount > 0) discounts.push({ label: `Promo ${promoMatch[1].trim()}`, amount: promoAmount });
  if (loyalty > 0) discounts.push({ label: 'Potongan poin loyalty', amount: loyalty });
  const promoNote =
    promoMatch && promoAmount === 0 ? `Promo ${promoMatch[1].trim()} sudah memotong ongkir.` : undefined;
  return { isEstimate: true, items, itemsTotal, subtotal, discounts, deliveryFee, total, promoNote };
};
