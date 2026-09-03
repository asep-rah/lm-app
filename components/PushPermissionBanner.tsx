'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  currentPushActor,
  ensurePushSubscription,
  registerPushWorker,
  subscribePush
} from '@/lib/notifications';

const DISMISS_KEY = 'laundry_push_banner_dismissed';

export default function PushPermissionBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void registerPushWorker();
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const actor = currentPushActor();
    if (!actor) return;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') {
      if (Notification.permission === 'granted') void ensurePushSubscription();
      return;
    }
    if (Notification.permission === 'granted') {
      void ensurePushSubscription();
      return;
    }
    if (Notification.permission === 'default') setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-0 right-0 z-[70] px-3 pointer-events-none max-w-md mx-auto md:bottom-4">
      <div className="pointer-events-auto bg-white border border-blue-100 shadow-lg rounded-2xl px-3.5 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Bell className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold text-slate-900">Aktifkan notifikasi</p>
          <p className="text-[10px] text-slate-500 leading-snug">Dapatkan update pembayaran, chat CS, dan status cucian meski aplikasi di belakang.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await subscribePush();
            setBusy(false);
            setVisible(false);
            try {
              sessionStorage.setItem(DISMISS_KEY, '1');
            } catch {
              /* ignore */
            }
          }}
          className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold px-3 py-2 rounded-xl disabled:opacity-50"
        >
          {busy ? '…' : 'Izinkan'}
        </button>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            try {
              sessionStorage.setItem(DISMISS_KEY, '1');
            } catch {
              /* ignore */
            }
          }}
          className="shrink-0 text-[10px] font-bold text-slate-400"
        >
          Nanti
        </button>
      </div>
    </div>
  );
}
