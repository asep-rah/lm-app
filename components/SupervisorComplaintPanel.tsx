'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import {
  SUPERVISOR_DECISIONS,
  complaintStepOf,
  isComplaintIssue,
  issueDescriptionPlain,
  issueResi,
  supervisorDecide
} from '@/lib/csCare';

export default function SupervisorComplaintPanel({ agentName }: { agentName?: string }) {
  const [issues, setIssues] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from('outlet_issues').select('*').order('created_at', { ascending: false }).limit(40);
    setIssues(
      (data || []).filter((i: any) => isComplaintIssue(i) && complaintStepOf(i) === 'pending_supervisor')
    );
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('supervisor_complaint_panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outlet_issues' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const decide = async (issue: any, decision: string) => {
    setBusy(`${issue.id}-${decision}`);
    try {
      const { error } = await supervisorDecide({
        issue,
        decision,
        note,
        agentName: agentName || 'Supervisor'
      });
      if (error) {
        toast(error.message, 'err');
        return;
      }
      toast(`Keputusan ${SUPERVISOR_DECISIONS.find((d) => d.value === decision)?.label} dikirim ke CS Care.`, 'ok');
      setNote('');
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Supervisor</p>
          <h3 className="text-sm font-black text-slate-900">Persetujuan Komplain</h3>
        </div>
        <span className="text-[10px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
          {issues.length} menunggu
        </span>
      </div>
      {issues.length === 0 && (
        <p className="text-xs text-slate-400">Tidak ada temuan CS Care yang menunggu keputusan.</p>
      )}
      {issues.map((i) => (
        <div key={i.id} className="text-xs border border-amber-100 bg-amber-50/40 rounded-xl px-3 py-2.5 space-y-2">
          <p className="font-black text-slate-900 font-mono">{issueResi(i)}</p>
          <p className="text-slate-600 whitespace-pre-wrap">{issueDescriptionPlain(i)}</p>
          {i.findings && <p className="text-indigo-800">Temuan: {i.findings}</p>}
          {i.cctv_notes && <p className="text-slate-500">CCTV / log: {i.cctv_notes}</p>}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan Supervisor (opsional)"
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white"
          />
          <div className="grid grid-cols-3 gap-1.5">
            {SUPERVISOR_DECISIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                disabled={busy === `${i.id}-${d.value}`}
                onClick={() => decide(i, d.value)}
                className={`text-[10px] font-black py-2 rounded-lg text-white ${
                  d.value === 'reject' ? 'bg-rose-600' : d.value === 'cash' ? 'bg-emerald-600' : 'bg-indigo-600'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
