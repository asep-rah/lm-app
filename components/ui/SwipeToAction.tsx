'use client';

import { useRef, useState } from 'react';

export default function SwipeToAction({
  label,
  doneLabel,
  onComplete,
  disabled
}: {
  label: string;
  doneLabel?: string;
  onComplete: () => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const dragging = useRef(false);
  const [dx, setDx] = useState(0);
  const [fired, setFired] = useState(false);

  const maxDx = () => Math.max(80, (trackRef.current?.offsetWidth || 240) - 52);

  const onDown = (clientX: number) => {
    if (disabled || fired) return;
    dragging.current = true;
    startX.current = clientX;
  };

  const onMove = (clientX: number) => {
    if (!dragging.current) return;
    setDx(Math.max(0, Math.min(maxDx(), clientX - startX.current)));
  };

  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dx > maxDx() * 0.72) {
      setFired(true);
      setDx(maxDx());
      onComplete();
    } else {
      setDx(0);
    }
  };

  return (
    <div
      ref={trackRef}
      className={`relative h-14 rounded-2xl overflow-hidden select-none border ${
        disabled ? 'bg-slate-100 border-slate-200 opacity-60' : 'bg-emerald-50 border-emerald-200'
      }`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onDown(e.clientX);
      }}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500/20"
        style={{ width: Math.max(52, dx + 52) }}
      />
      <p className="absolute inset-0 flex items-center justify-center text-[11px] font-black uppercase tracking-wide text-emerald-800 pointer-events-none">
        {fired ? doneLabel || 'Selesai' : label}
      </p>
      <div
        className="absolute top-1.5 left-1.5 h-11 w-11 rounded-xl bg-emerald-500 text-white font-black flex items-center justify-center shadow-sm"
        style={{ transform: `translateX(${dx}px)` }}
      >
        ››
      </div>
    </div>
  );
}
