'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { notifyOps } from '@/lib/opsNotify';
import { FRAUD_ALERT_TEXT } from '@/lib/lgThinq';

type AlertRow = {
  id: string;
  machine_name?: string | null;
  notes?: string | null;
  is_flagged_tub_clean?: boolean | null;
  is_resolved?: boolean | null;
  detected_at?: string;
};

export default function WasherFraudAlertListener() {
  const [latest, setLatest] = useState<AlertRow | null>(null);

  useEffect(() => {
    supabase
      .from('unauthorized_wash_alerts')
      .select('id, machine_name, notes, is_flagged_tub_clean, is_resolved, detected_at')
      .eq('is_resolved', false)
      .order('detected_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) setLatest(data[0] as AlertRow);
      });

    const ch = supabase
      .channel('lg_thinq_fraud')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'unauthorized_wash_alerts' }, (payload) => {
        const row = payload.new as AlertRow;
        if (row.is_flagged_tub_clean) return;
        const text = row.notes || FRAUD_ALERT_TEXT(String(row.machine_name || 'ThinQ'));
        notifyOps('complaint', text, true);
        setLatest(row);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  if (!latest || latest.is_resolved) return null;

  return (
    <div className="rounded-2xl border border-rose-300 bg-rose-50 px-3.5 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-wide text-rose-700">Alert Fraud Mesin LG</p>
      <p className="text-xs font-bold text-rose-900 mt-0.5 leading-snug">
        {latest.notes || FRAUD_ALERT_TEXT(String(latest.machine_name || 'ThinQ'))}
      </p>
    </div>
  );
}
