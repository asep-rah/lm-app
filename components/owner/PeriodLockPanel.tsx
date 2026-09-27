'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { isStaffSessionError, staffRelogin } from '@/lib/staffRelogin';
import { toast } from '@/lib/toast';

type LockRow = { outlet_id: string; locked_through: string; updated_by?: string | null; updated_at?: string | null };

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const dateId = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Tutup buku per outlet (owner, /api/owner/period-lock). Setelah ditutup,
 * transaksi/pengeluaran/top up bulan itu tidak bisa ditambah atau diubah
 * nilainya dari aplikasi; void tetap boleh (dibalik di bulan void).
 */
export default function PeriodLockPanel({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [locks, setLocks] = useState<LockRow[] | null>(null);
  const [problem, setProblem] = useState<{ text: string; relogin: boolean } | null>(null);
  const [outlet, setOutlet] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/owner/period-lock', { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setProblem({ text: data?.error || 'Status tutup buku belum bisa dimuat.', relogin: isStaffSessionError(data) });
      setLocks([]);
      return;
    }
    setProblem(null);
    setLocks(Array.isArray(data.locks) ? data.locks : []);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const lockOf = (id: string) => (locks || []).find((l) => l.outlet_id === id)?.locked_through?.slice(0, 10) || '';

  const submit = async () => {
    if (!outlet) return setProblem({ text: 'Pilih outlet.', relogin: false });
    const current = lockOf(outlet);
    const target = `${month}-01`;
    let reason = '';
    if (current && target <= current) {
      reason = prompt(`${outlets.find((o) => o.id === outlet)?.name} sudah ditutup s.d. ${dateId(current)}.\nMembuka kembali periode wajib alasan:`) || '';
      if (reason.trim().length < 3) return;
    } else if (!confirm(`Tutup buku ${outlets.find((o) => o.id === outlet)?.name} sampai akhir ${month}?\nData bulan itu tidak bisa ditambah/diubah lagi dari aplikasi.`)) {
      return;
    }
    setBusy(true);
    const res = await fetch('/api/owner/period-lock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outletId: outlet, month, reason })
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setProblem({ text: data?.error || 'Tutup buku belum tersimpan.', relogin: isStaffSessionError(data) });
      return;
    }
    toast('Tutup buku tersimpan.', 'ok');
    void load();
  };

  return (
    <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-black inline-flex items-center gap-1.5"><Lock className="w-4 h-4" /> Tutup buku</h3>
        <p className="text-[11px] text-slate-400">
          Setelah laporan bulan selesai diperiksa, kunci periodenya. Transaksi, pengeluaran, dan top up bulan itu tidak bisa lagi
          ditambah atau diubah nilainya dari aplikasi (void tetap bisa dan dibalik di bulan void).
        </p>
      </div>
      {problem && (
        <div className="mx-4 mt-3 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 space-y-2" role="alert">
          <p>{problem.text}</p>
          {problem.relogin && (
            <button type="button" onClick={staffRelogin} className="bg-rose-600 text-white font-bold px-3 py-1.5 rounded-md">Masuk ulang</button>
          )}
        </div>
      )}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <select value={outlet} onChange={(e) => setOutlet(e.target.value)} aria-label="Outlet tutup buku" className="border rounded-lg p-2 bg-slate-50">
          <option value="">Pilih outlet…</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <input type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value)} aria-label="Bulan terakhir yang ditutup" className="border rounded-lg p-2" />
        <button type="button" onClick={submit} disabled={busy} className="bg-slate-900 text-white font-black rounded-lg py-2 disabled:opacity-50">
          {busy ? 'Menyimpan…' : 'Tutup buku s.d. bulan ini'}
        </button>
      </div>
      <ul className="px-4 pb-4 space-y-1 text-[11px]">
        {outlets.map((o) => {
          const l = lockOf(o.id);
          return (
            <li key={o.id} className="flex justify-between gap-2 border-t border-slate-100 pt-1">
              <span className="font-semibold">{o.name}</span>
              <span className={l ? 'text-emerald-700 font-bold' : 'text-slate-400'}>{l ? `Ditutup s.d. ${dateId(l)}` : 'Belum ditutup'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
