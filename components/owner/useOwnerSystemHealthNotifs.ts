'use client';

import { useEffect, useState } from 'react';
import { paymentOpsClientHeaders } from '@/lib/requirePaymentOpsAuth';

function staffQuery() {
  const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
  let staffId = '';
  let role = 'owner';
  let agentName = 'Owner';
  try {
    const u = raw ? JSON.parse(raw) : {};
    staffId = String(u.id || u.username || '');
    role = String(u.role || 'owner').toLowerCase();
    agentName = String(u.name || 'Owner');
  } catch {
    /* ignore */
  }
  return new URLSearchParams({ staffId, role, agentName, summary: '1' });
}

/** Badge diagnosis — lewat API (service role), bukan anon ke error_logs. */
export function useOwnerSystemHealthNotifs() {
  const [errorCount, setErrorCount] = useState(0);
  const [pendingPayCount, setPendingPayCount] = useState(0);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/owner/system-health?${staffQuery()}`, {
        headers: paymentOpsClientHeaders()
      });
      if (!res.ok) {
        setErrorCount(0);
        setPendingPayCount(0);
        return;
      }
      const json = await res.json().catch(() => ({}));
      setErrorCount(Number(json.errorCount) || 0);
      setPendingPayCount(Number(json.pendingPayCount) || 0);
    } catch {
      setErrorCount(0);
      setPendingPayCount(0);
    }
  };

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 90_000);
    return () => window.clearInterval(t);
  }, []);

  const unread = errorCount + pendingPayCount;
  return { unread, errorCount, pendingPayCount, refresh };
}
