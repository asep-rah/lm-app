'use client';

import { useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { staffSatuanPhotoUrl } from '@/lib/satuanItemPhoto';

/**
 * Tombol "Lihat foto" item satuan untuk staf. URL bertanda tangan (5 menit)
 * diminta ke server HANYA saat tombol ditekan; server memverifikasi sesi staf,
 * peran/outlet, dan bahwa foto memang milik pesanan ini.
 */
export default function SatuanItemPhotoButton({
  pickupOrderId,
  path,
  label = 'Lihat Foto'
}: {
  pickupOrderId?: string | null;
  path?: string | null;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!path || !pickupOrderId) return null;

  const open = async () => {
    setBusy(true);
    setError('');
    // Buka tab lebih dulu (dalam gesture klik) supaya tidak diblok popup blocker.
    const win = window.open('', '_blank');
    const res = await staffSatuanPhotoUrl(pickupOrderId, path);
    setBusy(false);
    if ('error' in res) {
      win?.close();
      setError(res.error);
      return;
    }
    if (win) {
      win.opener = null;
      win.location.href = res.url;
    } else {
      window.open(res.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-extrabold text-slate-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
        {busy ? 'Memuat…' : label}
      </button>
      {error && <span className="text-[9px] text-rose-600 font-bold">{error}</span>}
    </span>
  );
}
