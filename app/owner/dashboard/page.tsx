'use client';

import { useEffect } from 'react';

/** Duplikat berat dihilangkan — semua fitur di `/owner` (termasuk tab approvals). */
export default function OwnerDashboardRedirect() {
  useEffect(() => {
    const q = typeof window !== 'undefined' ? window.location.search || '' : '';
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
    if (!params.get('tab')) params.set('tab', 'pnl');
    const next = params.toString();
    window.location.replace(next ? `/owner?${next}` : '/owner');
  }, []);

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-slate-500 font-medium">
      Mengalihkan ke dashboard owner…
    </div>
  );
}
