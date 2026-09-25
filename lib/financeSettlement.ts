/**
 * Validasi pembayaran bagi hasil / THR yang dicatat owner (pure, dipakai
 * server /api/owner/finance-settlements dan form di laporan keuangan).
 */
export type SettlementKind = 'profit_share' | 'thr';
export type SettlementSource = 'bank' | 'laci' | 'dana_thr';

export const SETTLEMENT_KINDS: Record<SettlementKind, { label: string; sources: SettlementSource[] }> = {
  profit_share: { label: 'Bagi hasil pengelolaan', sources: ['bank', 'laci'] },
  thr: { label: 'THR crew', sources: ['dana_thr', 'bank', 'laci'] }
};

export const SOURCE_LABELS: Record<SettlementSource, string> = {
  bank: 'Rekening bank outlet',
  laci: 'Kas laci (tunai belum disetor)',
  dana_thr: 'Dana Tabungan THR'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SETTLEMENT = 10_000_000_000;

export type SettlementDraft = {
  outlet_id: string;
  kind: SettlementKind;
  amount: number;
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
  const note = String(b.note ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || null;
  return { ok: true, draft: { outlet_id: outlet, kind, amount, paid_at: paidAt, source, note } };
}

/** Baris tabel → bentuk jurnal (tanggal bayar dianggap siang WIB agar tidak meleset bulan). */
export const settlementForJournal = (r: Record<string, unknown>) => ({
  id: String(r.id),
  outlet_id: r.outlet_id ? String(r.outlet_id) : null,
  kind: (String(r.kind) === 'thr' ? 'thr' : 'profit_share') as SettlementKind,
  amount: Number(r.amount) || 0,
  paid_at: `${String(r.paid_at).slice(0, 10)}T12:00:00+07:00`,
  source: (['bank', 'laci', 'dana_thr'].includes(String(r.source)) ? String(r.source) : 'bank') as SettlementSource,
  note: r.note ? String(r.note) : null,
  voided_at: r.voided_at ? String(r.voided_at) : null
});
