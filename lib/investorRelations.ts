/**
 * Laporan investor & jadwal meeting (Owner Relation).
 *
 * ATURAN PENTING: file ini TIDAK menghitung ulang keuangan. Semua angka dirakit
 * dari lib/financeStatements.ts (periodRevenue, periodExpense, buildEquity,
 * buildBalanceSheet) yang sudah menjadi sumber otoritatif laporan owner. Rumus
 * baru di sini berarti investor dan owner melihat angka berbeda untuk periode
 * yang sama.
 */

import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import type { PnlMonthRef } from '@/lib/pnlReport';
import {
  buildBalanceSheet,
  buildEquity,
  periodExpense,
  periodRevenue
} from '@/lib/financeStatements';
import type { OutletBook } from '@/lib/outletBooks';

export const REPORT_STATUS = { DRAFT: 'draft', SENT: 'sent' } as const;
export const MEETING_STATUS = { SCHEDULED: 'scheduled', DONE: 'done', CANCELLED: 'cancelled' } as const;

// ---------------------------------------------------------------------------
// Periode triwulan
// ---------------------------------------------------------------------------

/** '2026-Q3' dari sebuah tanggal. */
export const quarterOf = (date: Date | string): string => {
  const d = date instanceof Date ? date : new Date(String(date));
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
};

/** Tiga bulan sebuah triwulan sebagai PnlMonthRef (month 0-based, seperti PnlMonthRef). */
export const quarterMonths = (quarter: string): PnlMonthRef[] => {
  const m = String(quarter || '').match(/^(\d{4})-Q([1-4])$/);
  if (!m) return [];
  const year = Number(m[1]);
  const firstMonth = (Number(m[2]) - 1) * 3;
  return [0, 1, 2].map((i) => ({ year, month: firstMonth + i }));
};

/** Tanggal awal & akhir triwulan, untuk kolom period_start / period_end. */
export const quarterBounds = (quarter: string): { start: string; end: string } | null => {
  const months = quarterMonths(quarter);
  if (!months.length) return null;
  const first = months[0];
  const last = months[2];
  const lastDay = new Date(Date.UTC(last.year, last.month + 1, 0)).getUTCDate();
  return {
    start: `${first.year}-${String(first.month + 1).padStart(2, '0')}-01`,
    end: `${last.year}-${String(last.month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  };
};

export const recentQuarters = (count = 4, now = new Date()): string[] => {
  const out: string[] = [];
  let year = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  for (let i = 0; i < count; i += 1) {
    out.push(`${year}-Q${q}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      year -= 1;
    }
  }
  return out;
};

export const quarterLabel = (quarter: string) => {
  const m = String(quarter || '').match(/^(\d{4})-Q([1-4])$/);
  if (!m) return quarter || '—';
  const names = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Okt–Des'];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
};

// ---------------------------------------------------------------------------
// Metrik periode
// ---------------------------------------------------------------------------

export type QuarterMetrics = {
  quarter: string;
  revenue: number;
  expense: number;
  /** Laba dari selisih pendapatan dan beban periode. */
  profit: number;
  /** Laba setelah bagi hasil, dari buildEquity pada bulan terakhir triwulan. */
  profitAfterShare: number;
  /** Rata-rata margin; null bila pendapatan nol supaya tidak muncul 0% yang menyesatkan. */
  marginPct: number | null;
  /** Posisi keuangan pada akhir triwulan. */
  totalAssets: number;
  totalLiabilities: number;
  endingEquity: number;
  cash: number;
  receivables: number;
  /** Rincian per bulan, supaya tren di dalam triwulan tetap terlihat. */
  months: { ref: PnlMonthRef; revenue: number; expense: number }[];
};

/**
 * Rakit metrik satu triwulan dari bundel keuangan yang sudah dimuat.
 *
 * Pendapatan & beban dijumlahkan per bulan memakai periodRevenue/periodExpense;
 * posisi keuangan diambil dari neraca pada bulan TERAKHIR triwulan (neraca
 * adalah posisi pada satu titik waktu, bukan penjumlahan tiga bulan).
 */
export const buildQuarterMetrics = (opts: {
  quarter: string;
  txs: any[];
  mems: any[];
  exps: any[];
  books: OutletBook[];
  rates?: Record<string, number>;
}): QuarterMetrics | null => {
  const months = quarterMonths(opts.quarter);
  if (!months.length) return null;

  const perMonth = months.map((ref) => ({
    ref,
    revenue: periodRevenue(opts.txs, opts.mems, ref),
    expense: periodExpense(opts.exps, ref)
  }));

  const revenue = perMonth.reduce((s, m) => s + m.revenue, 0);
  const expense = perMonth.reduce((s, m) => s + m.expense, 0);
  const lastRef = months[2];

  const equity = buildEquity({
    txs: opts.txs,
    mems: opts.mems,
    exps: opts.exps,
    books: opts.books,
    ref: lastRef,
    rates: opts.rates
  });
  const balance = buildBalanceSheet({
    txs: opts.txs,
    mems: opts.mems,
    exps: opts.exps,
    books: opts.books,
    asOf: lastRef,
    rates: opts.rates
  });

  return {
    quarter: opts.quarter,
    revenue,
    expense,
    profit: revenue - expense,
    // buildEquity melaporkan laba BULAN terakhir setelah bagi hasil, bukan
    // triwulan. Dipakai apa adanya dan diberi label bulanan di UI daripada
    // dikarang menjadi angka triwulan dengan rumus sendiri.
    profitAfterShare: equity.periodProfitAfterShare,
    marginPct: revenue > 0 ? Number((((revenue - expense) / revenue) * 100).toFixed(1)) : null,
    totalAssets: balance.totalAssets,
    totalLiabilities: balance.totalLiab,
    endingEquity: equity.endingEquity,
    cash: balance.cash,
    receivables: balance.receivables,
    months: perMonth
  };
};

/**
 * Bagi hasil sebagai LAPORAN, bukan pencatatan transaksi.
 *
 * Pencatatan dividen menyentuh domain finance yang dilindungi dan butuh putusan
 * terpisah (lihat rencana Fase 3). Yang ditampilkan di sini murni hitungan dari
 * persentase bagi hasil yang sudah tersimpan di app_settings.
 */
export type ProfitShareLine = { outletId: string; ratePct: number; share: number };

export const profitShareReport = (opts: {
  profit: number;
  rates: Record<string, number>;
  defaultPct: number;
  outletIds: string[];
}): { lines: ProfitShareLine[]; total: number } => {
  const lines = opts.outletIds.map((outletId) => {
    const ratePct = Number(opts.rates[outletId] ?? opts.defaultPct) || 0;
    return {
      outletId,
      ratePct,
      // Laba negatif tidak menghasilkan bagi hasil negatif -- tidak ada tagihan
      // ke penerima bagi hasil saat rugi.
      share: opts.profit > 0 ? Math.round((opts.profit * ratePct) / 100) : 0
    };
  });
  return { lines, total: lines.reduce((s, l) => s + l.share, 0) };
};

// ---------------------------------------------------------------------------
// Laporan & meeting
// ---------------------------------------------------------------------------

export type InvestorReport = {
  id: string;
  quarter: string | null;
  period_start: string | null;
  period_end: string | null;
  title: string | null;
  summary: string | null;
  metrics: Partial<QuarterMetrics> | null;
  attachments: unknown[] | null;
  status: string;
  sent_at: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type InvestorMeeting = {
  id: string;
  scheduled_at: string;
  quarter: string | null;
  agenda: string | null;
  location: string | null;
  attendees: unknown[] | null;
  report_id: string | null;
  minutes: string | null;
  status: string;
  created_at: string;
};

export const loadInvestorReports = async (limit = 20): Promise<InvestorReport[]> => {
  const { data, error } = await supabase
    .from('investor_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('investor_reports:', error.message);
    return [];
  }
  return (data as InvestorReport[]) || [];
};

export const loadInvestorMeetings = async (limit = 20): Promise<InvestorMeeting[]> => {
  const { data, error } = await supabase
    .from('investor_meetings')
    .select('*')
    .order('scheduled_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('investor_meetings:', error.message);
    return [];
  }
  return (data as InvestorMeeting[]) || [];
};

/**
 * Simpan laporan dengan metrik yang DIBEKUKAN saat itu.
 *
 * Angka disimpan di kolom metrics, tidak dihitung ulang saat laporan dibuka:
 * laporan yang sudah dikirim ke investor harus menunjukkan angka yang sama
 * dengan yang mereka terima, walau data operasional berubah setelahnya.
 */
export const saveInvestorReport = async (opts: {
  quarter: string;
  title: string;
  summary: string;
  metrics: QuarterMetrics;
  createdBy: string;
}) => {
  const bounds = quarterBounds(opts.quarter);
  const row = {
    quarter: opts.quarter,
    period_start: bounds?.start || null,
    period_end: bounds?.end || null,
    title: opts.title.trim() || `Laporan Investor ${quarterLabel(opts.quarter)}`,
    summary: opts.summary.trim() || null,
    metrics: opts.metrics,
    status: REPORT_STATUS.DRAFT,
    created_by_name: opts.createdBy
  };
  const ins = await insertWithFallback<{ id: string }>(
    'investor_reports',
    [row, { quarter: row.quarter, title: row.title, metrics: row.metrics, status: row.status }],
    { select: 'id' }
  );
  return { error: ins.error, id: ins.data?.[0]?.id || null };
};

export const markReportSent = async (reportId: string) =>
  updateWithFallback(
    'investor_reports',
    [{ status: REPORT_STATUS.SENT, sent_at: new Date().toISOString() }, { status: REPORT_STATUS.SENT }],
    { column: 'id', value: reportId }
  );

export const scheduleInvestorMeeting = async (opts: {
  scheduledAt: string;
  quarter?: string;
  agenda: string;
  location?: string;
  reportId?: string | null;
  createdBy: string;
}) => {
  const when = new Date(opts.scheduledAt);
  if (isNaN(when.getTime())) return { error: { message: 'Tanggal meeting tidak valid.' } };
  const row = {
    scheduled_at: when.toISOString(),
    quarter: opts.quarter || quarterOf(when),
    agenda: opts.agenda.trim() || null,
    location: opts.location?.trim() || null,
    report_id: opts.reportId || null,
    status: MEETING_STATUS.SCHEDULED,
    created_by_name: opts.createdBy
  };
  const ins = await insertWithFallback(
    'investor_meetings',
    [row, { scheduled_at: row.scheduled_at, agenda: row.agenda, status: row.status }]
  );
  return { error: ins.error };
};

export const saveMeetingMinutes = async (opts: { meetingId: string; minutes: string }) =>
  updateWithFallback(
    'investor_meetings',
    [
      { minutes: opts.minutes, status: MEETING_STATUS.DONE },
      { minutes: opts.minutes }
    ],
    { column: 'id', value: opts.meetingId }
  );

export const upcomingMeetings = (meetings: InvestorMeeting[], now = Date.now()) =>
  meetings
    .filter(
      (m) =>
        String(m.status || '').toLowerCase() === MEETING_STATUS.SCHEDULED &&
        new Date(m.scheduled_at).getTime() >= now
    )
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
