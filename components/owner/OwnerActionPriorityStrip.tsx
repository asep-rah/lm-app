'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { paymentOpsClientHeaders } from '@/lib/requirePaymentOpsAuth';

type Summary = {
  pendingPayCount: number | null;
  errorCount: number | null;
  loading: boolean;
  unavailable: boolean;
};

function staffQuery() {
  try {
    const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
    const u = raw ? JSON.parse(raw) : {};
    return new URLSearchParams({
      staffId: String(u.id || u.username || ''),
      role: String(u.role || 'owner').toLowerCase(),
      agentName: String(u.name || 'Owner'),
      summary: '1'
    });
  } catch {
    return new URLSearchParams({ role: 'owner', agentName: 'Owner', summary: '1' });
  }
}

/** Kartu tindak lanjut di dashboard owner (pembayaran tertunda / error terbuka). */
export default function OwnerActionPriorityStrip() {
  const [summary, setSummary] = useState<Summary>({
    pendingPayCount: null,
    errorCount: null,
    loading: true,
    unavailable: false
  });

  const load = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/owner/system-health?${staffQuery()}`, {
        headers: paymentOpsClientHeaders()
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSummary({
          pendingPayCount: null,
          errorCount: null,
          loading: false,
          unavailable: true
        });
        return;
      }
      setSummary({
        pendingPayCount: Number(json.pendingPayCount) || 0,
        errorCount: Number(json.errorCount) || 0,
        loading: false,
        unavailable: false
      });
    } catch {
      setSummary({
        pendingPayCount: null,
        errorCount: null,
        loading: false,
        unavailable: true
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (summary.loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[11px] text-slate-500" role="status">
        Memuat item yang perlu ditindaklanjuti…
      </div>
    );
  }

  if (summary.unavailable) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wide text-amber-800">Diagnosis pembayaran</p>
          <p className="text-xs font-semibold text-amber-950 mt-0.5">
            Status pending bayar belum diperiksa / tidak tersedia. Buka Diagnosis Sistem untuk memeriksa manual.
          </p>
        </div>
        <Link
          href="/owner/system-health"
          className="shrink-0 text-[11px] font-bold px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center rounded-xl bg-slate-900 text-white"
        >
          Buka Diagnosis
        </Link>
      </div>
    );
  }

  const pending = summary.pendingPayCount ?? 0;
  const errors = summary.errorCount ?? 0;
  const hot = pending > 0 || errors > 0;

  return (
    <div
      className={`rounded-2xl border px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${
        hot ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p
          className={`text-[10px] font-black uppercase tracking-wide ${
            hot ? 'text-amber-800' : 'text-slate-400'
          }`}
        >
          Tindak lanjut pembayaran
        </p>
        <p className={`text-xs font-semibold mt-0.5 ${hot ? 'text-amber-950' : 'text-slate-700'}`}>
          {hot
            ? `${pending} pesanan pending bayar · ${errors} error terbuka`
            : 'Tidak ada pending bayar atau error terbuka pada sampel diagnosis terbaru.'}
        </p>
        <p className={`text-[10px] mt-1 ${hot ? 'text-amber-700' : 'text-slate-400'}`}>
          Angka dari Diagnosis Sistem (sampel transaksi terbaru), bukan klaim seluruh histori.
        </p>
      </div>
      <Link
        href="/owner/system-health"
        className={`shrink-0 text-[11px] font-bold px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center rounded-xl text-white ${
          hot ? 'bg-amber-700' : 'bg-slate-800'
        }`}
      >
        {hot ? 'Periksa Diagnosis' : 'Lihat Diagnosis'}
      </Link>
    </div>
  );
}
