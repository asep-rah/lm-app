'use client';

export default function PhotoLightbox({
  src,
  onClose
}: {
  src: string | null;
  onClose: () => void;
}) {
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Bukti foto" className="w-full max-h-[85vh] object-contain rounded-2xl bg-black" />
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full bg-white text-slate-900 font-extrabold py-2.5 rounded-xl text-xs"
        >
          Kembali
        </button>
      </div>
    </div>
  );
}
