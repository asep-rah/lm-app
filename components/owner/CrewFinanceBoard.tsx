'use client';

import { useMemo, useState } from 'react';
import {
  idr,
  isLoanApproved,
  isLoanPending,
  isLoanRejected,
  loanProgress
} from '@/lib/crewFinance';

type Props = {
  loans: any[];
  penalties: any[];
  onMarkLoanPaid?: (id: string) => void;
};

export default function CrewFinanceBoard({ loans, penalties, onMarkLoanPaid }: Props) {
  const [loanFilter, setLoanFilter] = useState<'approved' | 'belum' | 'lunas' | 'pending'>('approved');

  const approved = useMemo(() => loans.filter(isLoanApproved), [loans]);
  const pending = useMemo(() => loans.filter(isLoanPending), [loans]);
  const rejected = useMemo(() => loans.filter(isLoanRejected), [loans]);

  const rows = useMemo(() => {
    const source =
      loanFilter === 'pending'
        ? pending
        : approved.filter((l) => {
            const p = loanProgress(l);
            if (loanFilter === 'lunas') return p.statusPaid;
            if (loanFilter === 'belum') return !p.statusPaid;
            return true;
          });
    return source
      .map((loan) => ({ loan, progress: loanProgress(loan) }))
      .sort((a, b) => Number(a.progress.statusPaid) - Number(b.progress.statusPaid));
  }, [approved, pending, loanFilter]);

  const openCount = approved.filter((l) => !loanProgress(l).statusPaid).length;
  const paidCount = approved.filter((l) => loanProgress(l).statusPaid).length;
  const openNominal = approved.reduce((s, l) => {
    const p = loanProgress(l);
    return s + (p.statusPaid ? 0 : p.remainingRp);
  }, 0);
  const penaltyTotal = penalties.reduce((s, p) => s + (Number(p.penalty_amount) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Kasbon di-ACC" value={String(approved.length)} />
        <Stat label="Belum lunas" value={String(openCount)} hint={idr(openNominal)} />
        <Stat label="Sudah lunas" value={String(paidCount)} />
        <Stat label="Potongan tercatat" value={String(penalties.length)} hint={idr(penaltyTotal)} />
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900">Kasbon yang sudah di-ACC</h3>
            <p className="text-[11px] text-slate-400">Pengajuan crew lewat POS. Di sini hanya pantau pelunasan dan sisa cicilan.</p>
          </div>
          <select
            value={loanFilter}
            onChange={(e) => setLoanFilter(e.target.value as typeof loanFilter)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-slate-50"
          >
            <option value="approved">Semua yang di-ACC</option>
            <option value="belum">Belum lunas</option>
            <option value="lunas">Sudah lunas</option>
            <option value="pending">Menunggu ACC ({pending.length})</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold">
              <tr>
                <th className="p-3 text-left">Karyawan</th>
                <th className="p-3 text-left">Alasan</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-right">Cicilan / bln</th>
                <th className="p-3 text-right">Sisa</th>
                <th className="p-3 text-center">Cicilan lagi</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-left">Disetujui</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ loan, progress }) => (
                <tr key={loan.id} className="border-t border-slate-100">
                  <td className="p-3 font-bold text-slate-800">{loan.employee_name || '—'}</td>
                  <td className="p-3 text-slate-500 max-w-[200px]">
                    <p className="truncate">{loan.notes || loan.reason || '—'}</p>
                    {loan.document_url ? (
                      <p className="text-[10px] text-slate-400 font-mono truncate">SP: {loan.document_url}</p>
                    ) : null}
                  </td>
                  <td className="p-3 text-right font-bold">{idr(progress.total)}</td>
                  <td className="p-3 text-right">{progress.monthly ? idr(progress.monthly) : '—'}</td>
                  <td className="p-3 text-right font-black">{idr(progress.remainingRp)}</td>
                  <td className="p-3 text-center font-bold">
                    {progress.statusPaid ? (
                      '0×'
                    ) : (
                      <>
                        {progress.remainingMonths}× lagi
                        {progress.plannedMonths > 0 ? (
                          <span className="block text-[10px] font-semibold text-slate-400">
                            {progress.paidMonths}/{progress.plannedMonths} bln
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        isLoanPending(loan)
                          ? 'bg-amber-100 text-amber-800'
                          : progress.statusPaid
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {isLoanPending(loan) ? 'Menunggu ACC' : progress.label}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">{loan.approved_by || '—'}</td>
                  <td className="p-3 text-right">
                    {!progress.statusPaid && !isLoanPending(loan) && onMarkLoanPaid ? (
                      <button
                        type="button"
                        onClick={() => onMarkLoanPaid(String(loan.id))}
                        className="text-[10px] font-bold text-emerald-700"
                      >
                        Tandai lunas
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    {loanFilter === 'pending'
                      ? 'Tidak ada kasbon menunggu ACC.'
                      : 'Belum ada kasbon yang sudah disetujui.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rejected.length > 0 && loanFilter === 'approved' && (
          <p className="px-4 py-2 text-[10px] text-slate-400">{rejected.length} kasbon ditolak tidak ditampilkan di daftar ACC.</p>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-900">Data potongan kesalahan</h3>
          <p className="text-[11px] text-slate-400">Semua potongan yang sudah dicatat, bukan form pengajuan.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold">
              <tr>
                <th className="p-3 text-left">Tanggal</th>
                <th className="p-3 text-left">Karyawan</th>
                <th className="p-3 text-left">Deskripsi</th>
                <th className="p-3 text-right">Nominal</th>
              </tr>
            </thead>
            <tbody>
              {penalties.map((pen) => (
                <tr key={pen.id} className="border-t border-slate-100">
                  <td className="p-3 text-slate-500">
                    {pen.created_at ? new Date(pen.created_at).toLocaleDateString('id-ID') : '—'}
                  </td>
                  <td className="p-3 font-bold text-slate-800">{pen.employee_name || '—'}</td>
                  <td className="p-3 text-slate-600">{pen.reason || '—'}</td>
                  <td className="p-3 text-right font-black text-rose-700">{idr(Number(pen.penalty_amount) || 0)}</td>
                </tr>
              ))}
              {penalties.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    Belum ada data potongan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
      <p className="text-xl font-black text-slate-900 mt-0.5">{value}</p>
      {hint ? <p className="text-[10px] text-slate-500 font-bold">{hint}</p> : null}
    </div>
  );
}
