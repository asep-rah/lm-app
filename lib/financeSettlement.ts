/**
 * Validasi pembayaran bagi hasil / THR yang dicatat owner (pure, dipakai
 * server /api/owner/finance-settlements dan form di laporan keuangan).
 */
export type SettlementKind = 'profit_share' | 'thr' | 'gateway_payout';
export type SettlementSource = 'bank' | 'laci' | 'dana_thr' | 'clearing';

export const SETTLEMENT_KINDS: Record<SettlementKind, { label: string; sources: SettlementSource[] }> = {
  profit_share: { label: 'Bagi hasil pengelolaan', sources: ['bank', 'laci'] },
  thr: { label: 'THR crew', sources: ['dana_thr', 'bank', 'laci'] },
  // Saldo Mayar (QRIS/Gateway Clearing) dicairkan ke rekening bank outlet.
  gateway_payout: { label: 'Pencairan Mayar ke bank', sources: ['clearing'] }
};

export const SOURCE_LABELS: Record<SettlementSource, string> = {
  bank: 'Rekening bank outlet',
  laci: 'Kas laci (tunai belum disetor)',
  dana_thr: 'Dana Tabungan THR',
  clearing: 'Saldo Mayar (QRIS / Gateway Clearing)'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SETTLEMENT = 10_000_000_000;

export type SettlementDraft = {
  outlet_id: string;
  kind: SettlementKind;
  amount: number;
  /** Pencairan Mayar: potongan fee/MDR. Selain itu 0. */
  fee: number;
  paid_at: string;
  source: SettlementSource;
  note: string | null;
};

/** Tanggal lokal (Asia/Jakarta, UTC+7) hari ini, YYYY-MM-DD. */
export const jakartaToday = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export function validateSettlement(input: unknown, today = jakartaToday()): { ok: true; draft: SettlementDraft } | { ok: false; error: string } {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const outlet = String(b.outletId ?? b.outlet_id ?? '');
  if (!UUID.test(outlet)) return { ok: false, error: 'Pilih satu outlet.' };
  const kind = String(b.kind || '') as SettlementKind;
  if (!SETTLEMENT_KINDS[kind]) return { ok: false, error: 'Jenis pembayaran tidak dikenal.' };
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Nominal harus lebih dari 0.' };
  if (amount > MAX_SETTLEMENT) return { ok: false, error: 'Nominal terlalu besar.' };
  const paidAt = String(b.paidAt ?? b.paid_at ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt) || Number.isNaN(Date.parse(`${paidAt}T00:00:00Z`))) {
    return { ok: false, error: 'Tanggal bayar tidak valid.' };
  }
  if (paidAt > today) return { ok: false, error: 'Tanggal bayar tidak boleh di masa depan.' };
  if (paidAt < '2020-01-01') return { ok: false, error: 'Tanggal bayar terlalu lama.' };
  const source = String(b.source || '') as SettlementSource;
  if (!SETTLEMENT_KINDS[kind].sources.includes(source)) return { ok: false, error: 'Sumber dana tidak sesuai jenis pembayaran.' };
  const fee = kind === 'gateway_payout' ? Math.round(Number(b.fee || 0) * 100) / 100 : 0;
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_SETTLEMENT) return { ok: false, error: 'Fee tidak valid.' };
  const note = String(b.note ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || null;
  return { ok: true, draft: { outlet_id: outlet, kind, amount, fee, paid_at: paidAt, source, note } };
}

/** Baris tabel → bentuk jurnal (tanggal bayar dianggap siang WIB agar tidak meleset bulan). */
export const settlementForJournal = (r: Record<string, unknown>) => ({
  id: String(r.id),
  outlet_id: r.outlet_id ? String(r.outlet_id) : null,
  kind: (['thr', 'gateway_payout'].includes(String(r.kind)) ? String(r.kind) : 'profit_share') as SettlementKind,
  amount: Number(r.amount) || 0,
  fee: Number(r.fee) || 0,
  paid_at: `${String(r.paid_at).slice(0, 10)}T12:00:00+07:00`,
  source: (['bank', 'laci', 'dana_thr', 'clearing'].includes(String(r.source)) ? String(r.source) : 'bank') as SettlementSource,
  note: r.note ? String(r.note) : null,
  voided_at: r.voided_at ? String(r.voided_at) : null
});

/** Pilihan sumber dana pengeluaran (expenses.paid_from); kosong = kas laci. */
export const EXPENSE_PAID_FROM = [
  { value: 'laci', label: 'Kas laci outlet (tunai)' },
  { value: 'bank', label: 'Rekening bank outlet' },
  { value: 'clearing', label: 'Saldo Mayar' },
  { value: 'owner', label: 'Uang pribadi owner (dicatat setoran modal)' }
] as const;
