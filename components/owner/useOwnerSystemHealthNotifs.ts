'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** Jumlah error diagnosis terbuka + transaksi pending bayar (untuk badge icon). */
export function useOwnerSystemHealthNotifs() {
  const [errorCount, setErrorCount] = useState(0);
  const [pendingPayCount, setPendingPayCount] = useState(0);

  const refresh = async () => {
    try {
      const [{ count: errs }, { data: txs }] = await Promise.all([
        supabase
          .from('error_logs')
          .select('id', { count: 'exact', head: true })
          .eq('resolved', false),
        supabase
          .from('transactions')
          .select('id, payment_status, is_paid, status')
          .order('created_at', { ascending: false })
          .limit(60)
      ]);
      setErrorCount(Number(errs) || 0);
      const pending = (txs || []).filter((t: any) => {
        if (t?.is_paid === true) return false;
        const pay = String(t?.payment_status || '').toLowerCase();
        const st = String(t?.status || '').toLowerCase();
        if (['paid', 'lunas', 'verified'].includes(pay)) return false;
        return (
          pay === 'pending' ||
          pay === 'menunggu' ||
          st.includes('menunggu_pembayaran') ||
          st.includes('menunggu pembayaran')
        );
      }).length;
      setPendingPayCount(pending);
    } catch {
      /* tabel mungkin belum dimigrasi */
    }
  };

  useEffect(() => {
    void refresh();
    const ch = supabase
      .channel('owner_health_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'error_logs' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => void refresh())
      .subscribe();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, []);

  const unread = errorCount + pendingPayCount;
  return { unread, errorCount, pendingPayCount, refresh };
}
