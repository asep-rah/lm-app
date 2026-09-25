'use client';

import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import {
  SETTLEMENT_KINDS,
  SOURCE_LABELS,
  jakartaToday,
  type SettlementKind,
  type SettlementSource
} from '@/lib/financeSettlement';
import { isStaffSessionError, staffRelogin } from '@/lib/staffRelogin';
import { toast } from '@/lib/toast';

type Outstanding = { profitShare: number; thrPayable: number; thrFund: number };

type Props = {
  outlets: { id: string; name: string }[];
  /** Outlet dipilih di filter laporan ('ALL' = semua). */
  outletId: string;
  /** Saldo utang per outlet per hari ini (dari neraca outlet itu). */
  outstandingFor: (outletId: string) => Outstanding;
  settlements: Record<string, unknown>[];
  /** Pesan bila daftar pembayaran belum bisa dimuat (mis. sesi berakhir). */
  loadError: { text: string; relogin: boolean } | null;
  onChanged: () => void;
};

const rp = (n: number) => `Rp ${Math.round(n || 0).toLocaleString('id-ID')}`;

/**
 * Catat pembayaran bagi hasil pengelolaan dan THR crew (hanya owner, lewat
 * /api/owner/finance-settlements). Pembayaran mengurangi utangnya di neraca
 * dan mengurangi sumber dananya (bank / laci / Dana Tabungan THR).
 */
export default function SettlementPanel({ outlets, outletId, outstandingFor, settlements, loadError, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [outlet, setOutlet] = useState(outletId !== 'ALL' ? outletId : '');
  const [kind, setKind] = useState<SettlementKind>('profit_share');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(jakartaToday());
  const [source, setSource] = useState<SettlementSource>('bank');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; relogin: boolean } | null>(null);

  const due = outlet ? outstandingFor(outlet) : null;
  const dueNow = due ? (kind === 'thr' ? due.thrPayable : due.profitShare) : 0;
  const nameOf = (id: unknown) => outlets.find((o) => o.id === String(id))?.name || 'Outlet';
  const rows = useMemo(
    () =>
      [...settlements]
        .filter((r) => outletId === 'ALL' || String(r.outlet_id) === outletId)
        .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))
        .slice(0, 30),
    [settlements, outletId]
  );

  const chooseKind = (k: SettlementKind) => {
    setKind(k);
    setSource(SETTLEMENT_KINDS[k].sources[0]);
  };

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/owner/finance-settlements', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const text = data?.error || 'Belum tersimpan.';
      setProblem({ text, relogin: isStaffSessionError(data) });
      return false;
    }
    setProblem(null);
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(String(amount).replace(/\D/g, ''));
    if (!outlet) return setProblem({ text: 'Pilih outlet.', relogin: false });
    if (!(n > 0)) return setProblem({ text: 'Isi nominal pembayaran.', relogin: false });
    if (n > dueNow + 0.5 && !confirm(`Nominal ${rp(n)} lebih besar dari utang tercatat ${rp(dueNow)}. Tetap simpan?`)) return;
    if (kind === 'thr' && source === 'dana_thr' && due && n > due.thrFund + 0.5 &&
      !confirm(`Dana Tabungan THR hanya ${rp(due.thrFund)}. Tetap bayar ${rp(n)} dari dana ini?`)) return;
    setBusy(true);
    const ok = await call({ outletId: outlet, kind, amount: n, paidAt, source, note });
    setBusy(false);
    if (ok) {
      toast(`${SETTLEMENT_KINDS[kind].label} ${rp(n)} tercatat.`, 'ok');
      setAmount('');
      setNote('');
      setOpen(false);
      onChanged();
    }
  };

  const cancel = async (r: Record<string, unknown>) => {
    const reason = prompt('Alasan membatalkan catatan pembayaran ini?');
    if (!reason || reason.trim().length < 3) return;
    if (await call({ action: 'void', id: r.id, reason })) {
      toast('Catatan pembayaran dibatalkan.', 'ok');
      onChanged();
    }
  };

  const shown = problem || loadError;

  return (
    <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black">Pembayaran bagi hasil &amp; THR</h3>
          <p className="text-[11px] text-slate-400">Catat saat uangnya benar-benar dibayarkan. Utang di neraca berkurang otomatis.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 inline-flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-black px-3 py-2 rounded-xl"
        >
          <HandCoins className="w-4 h-4" /> {open ? 'Tutup' : 'Catat pembayaran'}
        </button>
      </div>

      {shown && (
        <div className="mx-4 mt-3 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 space-y-2" role="alert">
          <p>{shown.text}</p>
          {shown.relogin && (
            <button type="button" onClick={staffRelogin} className="bg-rose-600 text-white font-bold px-3 py-1.5 rounded-md">
              Masuk ulang
            </button>
          )}
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border-b">
          <label className="space-y-1">
            <span className="font-bold text-slate-500">Outlet</span>
            <select value={outlet} onChange={(e) => setOutlet(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" required>
              <option value="">Pilih outlet…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <span className="font-bold text-slate-500 block">Jenis</span>
            <div className="flex gap-1.5">
              {(Object.keys(SETTLEMENT_KINDS) as SettlementKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => chooseKind(k)}
                  className={`flex-1 rounded-lg px-2 py-2 font-bold border ${kind === k ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600'}`}
                >
                  {SETTLEMENT_KINDS[k].label}
                </button>
              ))}
            </div>
          </div>
          {due && (
            <p className="sm:col-span-2 text-[11px] text-slate-600 bg-slate-50 border rounded-lg px-3 py-2">
              Utang {SETTLEMENT_KINDS[kind].label.toLowerCase()} {nameOf(outlet)} saat ini: <b>{rp(dueNow)}</b>
              {kind === 'thr' ? <> · Dana Tabungan THR: <b>{rp(due.thrFund)}</b></> : null}
              {dueNow > 0 && (
                <button type="button" onClick={() => setAmount(String(Math.round(dueNow)))} className="ml-2 text-emerald-700 font-bold underline">
                  Isi sesuai utang
                </button>
              )}
            </p>
          )}
          <label className="space-y-1">
            <span className="font-bold text-slate-500">Nominal (Rp)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="0" className="w-full border rounded-lg p-2" required />
          </label>
          <label className="space-y-1">
            <span className="font-bold text-slate-500">Tanggal bayar</span>
            <input type="date" value={paidAt} max={jakartaToday()} onChange={(e) => setPaidAt(e.target.value)} className="w-full border rounded-lg p-2" required />
          </label>
          <label className="space-y-1">
            <span className="font-bold text-slate-500">Dibayar dari</span>
            <select value={source} onChange={(e) => setSource(e.target.value as SettlementSource)} className="w-full border rounded-lg p-2 bg-slate-50">
              {SETTLEMENT_KINDS[kind].sources.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-bold text-slate-500">Catatan (opsional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="mis. bagi hasil Agustus" className="w-full border rounded-lg p-2" />
          </label>
          {kind === 'thr' && (
            <p className="sm:col-span-2 text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              THR yang sudah ditabung (kategori pengeluaran &quot;Tabungan THR&quot;) dibayar lewat tombol ini, bukan dicatat lagi sebagai
              pengeluaran &quot;THR Crew&quot;, supaya bebannya tidak terhitung dua kali.
            </p>
          )}
          <button type="submit" disabled={busy} className="sm:col-span-2 bg-slate-900 text-white font-black rounded-xl py-2.5 disabled:opacity-50">
            {busy ? 'Menyimpan…' : 'Simpan pembayaran'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold">
            <tr>
              <th className="p-3 text-left">Tanggal</th>
              <th className="p-3 text-left">Outlet</th>
              <th className="p-3 text-left">Jenis</th>
              <th className="p-3 text-left">Dari</th>
              <th className="p-3 text-right">Nominal</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const voided = Boolean(r.voided_at);
              const k = (String(r.kind) === 'thr' ? 'thr' : 'profit_share') as SettlementKind;
              return (
                <tr key={String(r.id)} className={`border-t border-slate-100 ${voided ? 'text-slate-400 line-through' : ''}`}>
                  <td className="p-3">{String(r.paid_at).slice(0, 10)}</td>
                  <td className="p-3">{nameOf(r.outlet_id)}</td>
                  <td className="p-3">{SETTLEMENT_KINDS[k].label}{r.note ? ` · ${String(r.note)}` : ''}</td>
                  <td className="p-3">{SOURCE_LABELS[String(r.source) as SettlementSource] || String(r.source)}</td>
                  <td className="p-3 text-right font-bold">{rp(Number(r.amount))}</td>
                  <td className="p-3 text-right">
                    {voided ? (
                      <span className="no-underline">dibatalkan</span>
                    ) : (
                      <button type="button" onClick={() => cancel(r)} className="text-rose-600 font-bold">Batalkan</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-5 text-center text-slate-400">Belum ada pembayaran tercatat.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
