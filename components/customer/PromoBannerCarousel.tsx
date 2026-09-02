'use client';

import { useEffect, useRef, useState } from 'react';
import { withDefaultPromoBanner, type BannerSlide } from '@/lib/outletShowcase';

const AUTO_MS = 4000;

export default function PromoBannerCarousel({
  slides,
  onOpenOutlet,
  onOpenPromo
}: {
  slides: BannerSlide[];
  onOpenOutlet?: (outletId: string) => void;
  onOpenPromo?: (slide: BannerSlide) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const imageSlides = withDefaultPromoBanner(slides);

  useEffect(() => {
    if (paused || imageSlides.length < 2) return;
    const t = window.setInterval(() => {
      const el = scroller.current;
      if (!el) return;
      const next = (idx + 1) % imageSlides.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
      setIdx(next);
    }, AUTO_MS);
    return () => window.clearInterval(t);
  }, [idx, imageSlides.length, paused]);

  return (
    <div className="mb-4">
      <div
        ref={scroller}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (next !== idx) setIdx(next);
        }}
        className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth rounded-2xl hide-scrollbar touch-pan-x"
      >
        {imageSlides.map((slide) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => {
              if (slide.kind === 'promo') {
                onOpenPromo?.(slide);
                return;
              }
              if (slide.outletId) onOpenOutlet?.(slide.outletId);
            }}
            className="relative min-w-full snap-center h-36 sm:h-40 overflow-hidden rounded-2xl p-0 border-0 bg-slate-100"
            aria-label={slide.title || 'Promo'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slide.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {imageSlides.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {imageSlides.map((s, i) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-blue-600' : 'w-1.5 bg-slate-300'}`} />
          ))}
        </div>
      )}
    </div>
  );
}
