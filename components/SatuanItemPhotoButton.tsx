'use client';

import { useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { signedSatuanItemPhotoUrl } from '@/lib/satuanItemPhoto';

/**
 * Tombol "Lihat foto" untuk foto item satuan (bucket privat, path tersimpan
 * di items[].pieces[].photo_path — bukan URL publik). URL bertanda tangan
 * diminta HANYA saat tombol ditekan (deferred load, bukan auto-load semua
 * foto) — lihat docs/SECURITY_AND_MAINTENANCE.md §4.
 */
export default function SatuanItemPhotoButton({
  path,
  label = 'Lihat Foto',
  onOpenPhoto
}: {
  path?: string | null;
  label?: string;
  onOpenPhoto?: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!path) return null;

  const open = async () => {
    setBusy(true);
    setError('');
    const url = await signedSatuanItemPhotoUrl(path);
    setBusy(false);
    if (!url) {
      setError('Gagal memuat foto.');
      return;
    }
    if (onOpenPhoto) onOpenPhoto(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <span className="inline-flex items-center gap-1.5">
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
