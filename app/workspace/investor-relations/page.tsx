'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, homePathForRole } from '@/lib/staffSession';
import { toast } from '@/lib/toast';
import { loadOwnerFinanceBundle, ledgerTxsOf } from '@/lib/ownerFinanceData';
import { booksOf, loadOutletBooks, type OutletBook } from '@/lib/outletBooks';
import { DEFAULT_PROFIT_SHARE_PCT, loadProfitShareRates } from '@/lib/profitShare';
import {
  MEETING_STATUS,
  REPORT_STATUS,
  buildQuarterMetrics,
  loadInvestorMeetings,
  loadInvestorReports,
  markReportSent,
  profitShareReport,
  quarterLabel,
  quarterOf,
  recentQuarters,
  saveInvestorReport,
  saveMeetingMinutes,
  scheduleInvestorMeeting,
  upcomingMeetings,
  type InvestorMeeting,
  type InvestorReport,
  type QuarterMetrics
} from '@/lib/investorRelations';

type Outlet = { id: string; name: string };

const formatRp = (n: unknown) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
];

export default function InvestorRelationsPage() {
  const session = useMemo(() => getStaffSession(), []);
  const role = String(session.role || '').toLowerCase();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const [quarter, setQuarter] = useState(quarterOf(new Date()));
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [mems, setMems] = useState<any[]>([]);
  const [exps, setExps] = useState<any[]>([]);
  const [books, setBooks] = useState<OutletBook[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [reports, setReports] = useState<InvestorReport[]>([]);
  const [meetings, setMeetings] = useState<InvestorMeeting[]>([]);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [meetWhen, setMeetWhen] = useState('');
  const [meetAgenda, setMeetAgenda] = useState('');
  const [meetPlace, setMeetPlace] = useState('');
  const [minutes, setMinutes] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    if (!['owner_relation', 'owner', 'head', 'head_management'].includes(role)) {
      window.location.href = homePathForRole(role);
      return;
    }
    setReady(true);
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    const [bundle, store, share, reps, meets, { data: outs }] = await Promise.all([
      loadOwnerFinanceBundle(),
      loadOutletBooks(),
      loadProfitShareRates(),
      loadInvestorReports(),
      loadInvestorMeetings(),
      supabase.from('outlets').select('id, name').order('name')
    ]);
    // Transaksi void dikeluarkan lewat helper yang sama dengan laporan owner,
    // bukan disaring ulang di sini.
    setTxs(ledgerTxsOf({ txs: bundle.txs, voidedTxs: bundle.voidedTxs }));
    setMems(bundle.mems);
    setExps(bundle.exps);
    setBooks(booksOf(store, 'ALL'));
    setRates(share);
    setReports(reps);
    setMeetings(meets);
    setOutlets((outs as Outlet[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const metrics: QuarterMetrics | null = useMemo(
    () => buildQuarterMetrics({ quarter, txs, mems, exps, books, rates }),
    [quarter, txs, mems, exps, books, rates]
  );

  const share = useMemo(
    () =>
      metrics
        ? profitShareReport({
            profit: metrics.profit,
            rates,
            defaultPct: DEFAULT_PROFIT_SHARE_PCT,
            outletIds: outlets.map((o) => o.id)
          })
        : { lines: [], total: 0 },
    [metrics, rates, outlets]
  );

  const nextMeetings = useMemo(() => upcomingMeetings(meetings), [meetings]);

  const handleSaveReport = async () => {
    if (!metrics) return;
    setBusy('report');
    const { error } = await saveInvestorReport({
      quarter,
      title,
      summary,
      metrics,
      createdBy: session.name
    });
    setBusy('');
    if (error) return toast(error.message, 'err');
    setTitle('');
    setSummary('');
    toast('Draft laporan tersimpan dengan angka periode ini.', 'ok');
    load();
  };

  const handleMarkSent = async (report: InvestorReport) => {
    if (!confirm('Tandai laporan ini sudah dikirim ke investor?')) return;
    setBusy(report.id);
    const { error } = await markReportSent(report.id);
    setBusy('');
    if (error) return toast(error.message, 'err');
    toast('Laporan ditandai terkirim.', 'ok');
    load();
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('meeting');
    const { error } = await scheduleInvestorMeeting({
      scheduledAt: meetWhen,
      quarter,
      agenda: meetAgenda,
      location: meetPlace,
      createdBy: session.name
    });
    setBusy('');
    if (error) return toast(error.message, 'err');
    setMeetWhen('');
    setMeetAgenda('');
    setMeetPlace('');
    toast('Meeting dijadwalkan.', 'ok');
    load();
  };

  const handleSaveMinutes = async (meeting: InvestorMeeting) => {
    const text = (minutes[meeting.id] || '').trim();
    if (!text) return alert('Isi notulen terlebih dahulu.');
    setBusy(meeting.id);
    const { error } = await saveMeetingMinutes({ meetingId: meeting.id, minutes: text });
    setBusy('');
    if (error) return toast(error.message, 'err');
    toast('Notulen tersimpan, meeting ditandai selesai.', 'ok');
    load();
  };

  if (!ready) return <div className="min-h-screen bg-[#f7f7f5]" />;

  return (
    <div className="min-h-screen bg-[#f7f7f5] pb-20">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-bold text-slate-900">Owner Relation</h1>
            <p className="text-[11px] text-slate-500">
              {session.name} · laporan & meeting investor
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-2 text-[11px] bg-white"
            >
              {recentQuarters(8).map((q) => (
                <option key={q} value={q}>{quarterLabel(q)}</option>
              ))}
            </select>
            <Link
              href="/workspace"
              className="text-[11px] font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600"
            >
              Workspace
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Kinerja {quarterLabel(quarter)}
          </h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Angka dibaca dari laporan keuangan owner (jurnal, laba-rugi, neraca) — bukan hitungan
            terpisah, supaya tidak ada dua versi angka untuk periode yang sama.
          </p>
          {loading ? (
            <p className="text-xs text-slate-400">Memuat…</p>
          ) : !metrics ? (
            <p className="text-xs text-slate-400">Periode tidak valid.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Pendapatan</p>
                  <p className="text-sm font-bold text-slate-900">{formatRp(metrics.revenue)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Beban</p>
                  <p className="text-sm font-bold text-slate-900">{formatRp(metrics.expense)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Laba</p>
                  <p className={`text-sm font-bold ${metrics.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatRp(metrics.profit)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Margin</p>
                  <p className="text-sm font-bold text-slate-900">
                    {metrics.marginPct == null ? '—' : `${metrics.marginPct}%`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Total Aset</p>
                  <p className="text-xs font-bold text-slate-900">{formatRp(metrics.totalAssets)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Liabilitas</p>
                  <p className="text-xs font-bold text-slate-900">{formatRp(metrics.totalLiabilities)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Ekuitas Akhir</p>
                  <p className="text-xs font-bold text-slate-900">{formatRp(metrics.endingEquity)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Kas</p>
                  <p className="text-xs font-bold text-slate-900">{formatRp(metrics.cash)}</p>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                  Tren per bulan
                </p>
                <ul className="divide-y divide-slate-100">
                  {metrics.months.map((m) => (
                    <li key={`${m.ref.year}-${m.ref.month}`} className="py-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-slate-600">
                        {MONTHS[m.ref.month]} {m.ref.year}
                      </span>
                      <span className="text-slate-500">
                        {formatRp(m.revenue)} · beban {formatRp(m.expense)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Perhitungan Bagi Hasil</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Laporan saja, belum pencatatan transaksi. Persentase diambil dari pengaturan bagi hasil
            per outlet; default {DEFAULT_PROFIT_SHARE_PCT}%.
          </p>
          {share.lines.length === 0 ? (
            <p className="text-xs text-slate-400">Outlet belum dimuat.</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100">
                {share.lines.slice(0, 20).map((l) => (
                  <li key={l.outletId} className="py-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-slate-700 truncate">
                      {outlets.find((o) => o.id === l.outletId)?.name || l.outletId}
                    </span>
                    <span className="text-slate-500 shrink-0">
                      {l.ratePct}% · <b className="text-slate-900">{formatRp(l.share)}</b>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-600 mt-2">
                Total bagi hasil periode: <b>{formatRp(share.total)}</b>
              </p>
            </>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Susun Laporan Investor</h2>
          <div className="space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Laporan Investor ${quarterLabel(quarter)}`}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <textarea
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Ringkasan: pencapaian, kendala, rencana kuartal berikutnya"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <button
              type="button"
              disabled={busy === 'report' || !metrics}
              onClick={handleSaveReport}
              className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs disabled:opacity-50"
            >
              {busy === 'report' ? 'Menyimpan…' : 'SIMPAN DRAFT LAPORAN'}
            </button>
            <p className="text-[10px] text-slate-400">
              Angka dibekukan saat disimpan, supaya laporan yang sudah dikirim tetap menunjukkan
              angka yang diterima investor.
            </p>
          </div>

          {reports.length > 0 && (
            <div className="mt-4 space-y-2">
              {reports.slice(0, 10).map((r) => (
                <article key={r.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{r.title || '—'}</p>
                      <p className="text-[10px] text-slate-400">
                        {r.quarter ? quarterLabel(r.quarter) : '—'} · {r.created_by_name || '—'}
                        {r.metrics?.revenue != null && ` · ${formatRp(r.metrics.revenue)}`}
                      </p>
                    </div>
                    {String(r.status) === REPORT_STATUS.SENT ? (
                      <span className="shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">
                        Terkirim
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => handleMarkSent(r)}
                        className="shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-50"
                      >
                        Tandai Terkirim
                      </button>
                    )}
                  </div>
                  {r.summary && (
                    <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">{r.summary}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Meeting Investor</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            {nextMeetings.length} meeting terjadwal.
          </p>
          <form onSubmit={handleSchedule} className="grid grid-cols-2 gap-2">
            <input
              type="datetime-local"
              value={meetWhen}
              onChange={(e) => setMeetWhen(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
              required
            />
            <input
              value={meetPlace}
              onChange={(e) => setMeetPlace(e.target.value)}
              placeholder="Lokasi / tautan"
              className="border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <textarea
              rows={2}
              value={meetAgenda}
              onChange={(e) => setMeetAgenda(e.target.value)}
              placeholder="Agenda"
              className="col-span-2 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={busy === 'meeting'}
              className="col-span-2 bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs disabled:opacity-50"
            >
              {busy === 'meeting' ? 'Menyimpan…' : 'JADWALKAN MEETING'}
            </button>
          </form>

          <div className="mt-4 space-y-2">
            {meetings.slice(0, 10).map((m) => (
              <article key={m.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900">
                      {new Date(m.scheduled_at).toLocaleString('id-ID')}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {m.quarter ? quarterLabel(m.quarter) : '—'}
                      {m.location ? ` · ${m.location}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-lg border bg-slate-50 text-slate-600 border-slate-200">
                    {String(m.status) === MEETING_STATUS.DONE ? 'Selesai' : m.status}
                  </span>
                </div>
                {m.agenda && <p className="text-[11px] text-slate-600 mt-2">{m.agenda}</p>}
                {m.minutes ? (
                  <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                    <span className="font-semibold text-slate-500">Notulen:</span> {m.minutes}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={minutes[m.id] || ''}
                      onChange={(e) => setMinutes({ ...minutes, [m.id]: e.target.value })}
                      placeholder="Notulen hasil meeting"
                      className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-2 py-1.5 text-[10px]"
                    />
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => handleSaveMinutes(m)}
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-50"
                    >
                      Simpan Notulen
                    </button>
                  </div>
                )}
              </article>
            ))}
            {meetings.length === 0 && (
              <p className="text-xs text-slate-400">Belum ada meeting tercatat.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
