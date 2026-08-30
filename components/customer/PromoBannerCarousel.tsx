'use client';

import { useEffect, useRef, useState } from 'react';
import type { BannerSlide } from '@/lib/outletShowcase';

export default function PromoBannerCarousel({
  slides,
  onOpenOutlet
}: {
  slides: BannerSlide[];
  onOpenOutlet?: (outletId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = window.setInterval(() => {
      const next = (idx + 1) % slides.length;
      const el = scroller.current;
      if (el) {
        const w = el.clientWidth;
        el.scrollTo({ left: next * w, behavior: 'smooth' });
      }
      setIdx(next);
    }, 5500);
    return () => window.clearInterval(t);
  }, [idx, slides.length]);

  if (!slides.length) return null;

  return (
    <div className="mb-4">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (next !== idx) setIdx(next);
        }}
        className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth rounded-3xl hide-scrollbar"
      >
        {slides.map((slide) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => slide.outletId && onOpenOutlet?.(slide.outletId)}
            className="relative min-w-full snap-center h-36 sm:h-40 overflow-hidden text-left"
          >
            {slide.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slide.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div
                className={`absolute inset-0 ${
                  slide.kind === 'coming_soon'
                    ? 'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500'
                    : 'bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700'
                }`}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
            <div className="relative z-10 h-full flex flex-col justify-end p-4">
              {slide.kind === 'coming_soon' && (
                <span className="self-start mb-1 bg-amber-400 text-amber-950 text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full">
                  Coming Soon · Outlet Baru
                </span>
              )}
              <p className="text-white text-sm font-black leading-tight">{slide.title}</p>
              {slide.subtitle && <p className="text-white/85 text-[11px] font-medium mt-0.5 line-clamp-2">{slide.subtitle}</p>}
            </div>
          </button>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {slides.map((s, i) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-blue-600' : 'w-1.5 bg-slate-300'}`} />
          ))}
        </div>
      )}
    </div>
  );
}
