'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from '@/lib/toast';

type Props = {
  orderId: string;
  className?: string;
  onPaid?: () => void;
};

export default function CheckPaymentStatusButton({ orderId, className = '', onPaid }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!orderId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pay/check-status?order_id=${encodeURIComponent(orderId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal cek status');
      if (json.status === 'PAID' || json.is_paid) {
        toast(json.message || 'Pembayaran Lunas — status diperbarui.', 'ok');
        onPaid?.();
      } else {
        toast(json.message || 'Masih menunggu — belum terdeteksi lunas.', 'warn');
      }
    } catch (e: any) {
      toast(e?.message || 'Gagal cek status. Coba lagi nanti.', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-extrabold px-3 py-2 shadow-sm disabled:opacity-60 transition ${className}`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      Cek Status Pembayaran
    </button>
  );
}
