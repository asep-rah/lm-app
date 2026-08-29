'use client';

import { useEffect, useRef, useState } from 'react';

const FAB_SIZE = 48;
const FAB_MARGIN = 12;
const POS_KEY = 'laundry_home_chat_fab_pos';

const clampFab = (x: number, y: number) => {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN);
  const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN - 64);
  return {
    x: Math.min(maxX, Math.max(FAB_MARGIN, x)),
    y: Math.min(maxY, Math.max(FAB_MARGIN, y))
  };
};

const defaultFabPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 400 };
  return clampFab(window.innerWidth - FAB_SIZE - 16, window.innerHeight - FAB_SIZE - 96);
};

export default function DraggableChatFab({
  onOpen,
  hidden
}: {
  onOpen: () => void;
  hidden?: boolean;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const origin = useRef({ px: 0, py: 0, x: 0, y: 0 });
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          setPos(clampFab(parsed.x, parsed.y));
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setPos(defaultFabPos());
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => clampFab((p || defaultFabPos()).x, (p || defaultFabPos()).y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (hidden || !pos) return null;

  return (
    <button
      type="button"
      title="Mulai Chat"
      aria-label="Mulai Chat"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging.current = true;
        moved.current = false;
        origin.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - origin.current.px;
        const dy = e.clientY - origin.current.py;
        if (Math.abs(dx) + Math.abs(dy) > 8) moved.current = true;
        if (moved.current) {
          const next = clampFab(origin.current.x + dx, origin.current.y + dy);
          last.current = next;
          setPos(next);
        }
      }}
      onPointerUp={() => {
        dragging.current = false;
        if (moved.current) {
          const saved = last.current || pos;
          try {
            sessionStorage.setItem(POS_KEY, JSON.stringify(saved));
          } catch {
            /* ignore */
          }
          return;
        }
        onOpen();
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/35 border border-white/25 flex items-center justify-center touch-none select-none"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 12c0 3.9-3.6 7-8 7-.9 0-1.8-.1-2.6-.4L4 20l1.5-3.4C4.6 15.4 4 13.8 4 12c0-3.9 3.6-7 8-7s8 3.1 8 7Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">Mulai Chat</span>
    </button>
  );
}
