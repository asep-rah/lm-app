'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';

type OutletCap = { id: string; name: string; is_overcapacity?: boolean | null; is_coming_soon?: boolean | null };

/**
 * "Outlet penuh" switch — owner and supervisor only (enforced by
 * /api/staff/outlet-capacity). A full outlet is hidden from the customer
 * order form until it is opened again; nothing closes an outlet automatically.
 */
export default function OutletCapacityPanel({ compact = false }: { compact?: boolean }) {
  const [outlets, setOutlets] = useState<OutletCap[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('outlets')
      .select('id, name, is_overcapacity, is_coming_soon')
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setOutlets((data as OutletCap[]) || []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (o: OutletCap) => {
    const full = !o.is_overcapacity;
    if (full && !confirm(`Tandai "${o.name}" PENUH?\nOutlet ini tidak bisa dipilih pelanggan sampai dibuka lagi.`)) return;
    setBusy(o.id);
    try {
      const res = await fetch('/api/staff/outlet-capacity', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outletId: o.id, full })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error || 'Gagal mengubah status outlet.', 'err');
        return;
      }
      setOutlets((prev) => (prev || []).map((x) => (x.id === o.id ? { ...x, is_overcapacity: full } : x)));
      toast(full ? `${o.name} ditandai penuh — disembunyikan dari pelanggan.` : `${o.name} dibuka kembali.`, 'ok');
    } catch {
      toast('Koneksi bermasalah. Coba lagi.', 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={compact ? 'space-y-2' : 'bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm space-y-3 max-w-3xl'}>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status outlet penuh</p>
        <p className="text-[11px] text-slate-500">
          Hanya owner & supervisor. Outlet yang ditandai penuh tidak muncul di pilihan pesanan pelanggan sampai dibuka lagi.
        </p>
      </div>
      {outlets === null && <p className="text-xs text-slate-400">Memuat outlet…</p>}
      {outlets?.length === 0 && <p className="text-xs text-slate-400">Belum ada outlet.</p>}
      {(outlets || []).map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-2 text-xs border border-slate-100 rounded-lg px-2.5 py-2">
          <span className="font-semibold truncate">
            {o.name}
            {o.is_coming_soon ? <span className="text-amber-700 font-bold"> · Coming Soon</span> : null}
          </span>
          <button
            type="button"
            disabled={busy === o.id}
            onClick={() => toggle(o)}
            className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-md disabled:opacity-50 ${
              o.is_overcapacity ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {busy === o.id ? 'Menyimpan…' : o.is_overcapacity ? 'Penuh — buka lagi' : 'Buka — tandai penuh'}
          </button>
        </div>
      ))}
    </div>
  );
}
