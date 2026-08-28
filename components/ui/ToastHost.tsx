'use client';

import { useEffect, useState } from 'react';
import { subscribeToast, type ToastPayload } from '@/lib/toast';

export default function ToastHost() {
  const [items, setItems] = useState<(ToastPayload & { id: number })[]>([]);

  useEffect(() => {
    return subscribeToast((msg) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev.slice(-3), { ...msg, id }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, 3200);
    });
  }, []);

  if (!items.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[80] space-y-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto min-w-[220px] max-w-sm rounded-xl border px-3.5 py-2.5 text-xs font-semibold shadow-md bg-white ${
            t.tone === 'err'
              ? 'border-rose-200 text-rose-700'
              : t.tone === 'warn'
              ? 'border-amber-200 text-amber-800'
              : 'border-emerald-200 text-emerald-800'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
