'use client';

import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import PhotoLightbox from '@/components/PhotoLightbox';

/**
 * Bukti foto tidak di-download sampai user menekan "Lihat foto".
 * Hemat bandwidth di list order / timeline / chat.
 */
export default function DeferredProofPhoto({
  src,
  label = 'Lihat foto',
  count,
  className = '',
  onOpen
}: {
  src?: string | null;
  label?: string;
  /** Jika >1, teks jadi "Lihat N foto". */
  count?: number;
  className?: string;
  /** Jika diisi, parent yang membuka lightbox (tanpa load img di sini). */
  onOpen?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const url = String(src || '').trim();
  if (!url) return null;

  const n = count && count > 1 ? count : 0;
  const text = n ? `Lihat ${n} foto` : label;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (onOpen) onOpen(url);
          else setOpen(true);
        }}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-extrabold text-slate-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-800 transition ${className}`}
      >
        <ImageIcon className="w-3.5 h-3.5 shrink-0" />
        {text}
      </button>
      {!onOpen && <PhotoLightbox src={open ? url : null} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Beberapa URL — satu tombol; buka foto pertama (atau via onOpenEach). */
export function DeferredProofPhotos({
  urls,
  onOpen,
  className = ''
}: {
  urls: (string | null | undefined)[];
  onOpen?: (url: string) => void;
  className?: string;
}) {
  const list = urls.map((u) => String(u || '').trim()).filter(Boolean);
  if (!list.length) return null;
  return (
    <DeferredProofPhoto
      src={list[0]}
      count={list.length}
      onOpen={onOpen}
      className={className}
    />
  );
}
