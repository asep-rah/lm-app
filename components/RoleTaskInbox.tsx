'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession } from '@/lib/staffSession';
import { inboxRolesFor, isTaskCompleted, isTaskOverdueOpen } from '@/lib/taskRoles';
import { completeTaskWithSlaCheck } from '@/utils/taskSlaEvaluator';

export default function RoleTaskInbox({ role }: { role?: string }) {
  const session = getStaffSession();
  const actorRole = (role || session.role).toLowerCase();
  const aliases = inboxRolesFor(actorRole);

  const [tasks, setTasks] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!aliases.length) return;
    const { data, error } = await supabase
      .from('system_tasks')
      .select('*')
      .in('assigned_to_role', aliases)
      .order('due_date', { ascending: true });

    if (error) {
      console.warn('system_tasks inbox:', error.message);
      setTasks([]);
      return;
    }

    setTasks((data || []).filter((t) => !isTaskCompleted(t.status)));
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('realtime_system_tasks_' + actorRole)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_tasks' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorRole]);

  const handleComplete = async (taskId: string) => {
    setBusyId(taskId);
    const res = await completeTaskWithSlaCheck(taskId, {
      id: session.name,
      name: session.name,
      role: actorRole
    });
    setBusyId(null);

    if (!res.success) {
      alert('❌ ' + (res.message || 'Gagal menyelesaikan tugas'));
      return;
    }
    if (res.isOverdue) {
      alert(`⚠️ Selesai melewati SLA. KPI role ini dipotong ${Math.abs(res.penalty || 0)} poin.`);
    } else {
      alert(`✅ Tugas selesai tepat waktu. Bonus +${res.reward || 0} poin KPI.`);
    }
    load();
  };

  if (!aliases.length) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-black text-slate-800">📌 Tugas Head Management</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
          {tasks.length} aktif
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Tidak ada tugas SLA untuk role Anda.</p>
      ) : (
        tasks.map((t) => {
          const overdue = isTaskOverdueOpen(t);
          return (
            <div
              key={t.id}
              className={`border rounded-xl p-3 space-y-1.5 ${overdue ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-slate-50'}`}
            >
              <div className="flex justify-between gap-2">
                <p className="font-bold text-xs text-slate-800">{t.title}</p>
                <span className="text-[9px] font-bold uppercase text-slate-400">{t.assigned_to_role}</span>
              </div>
              {t.description && <p className="text-[11px] text-slate-500">{t.description}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${overdue ? 'bg-rose-100 text-rose-700' : 'bg-indigo-50 text-indigo-700'}`}>
                  SLA {t.sla_hours || '-'} jam · penalti -{t.kpi_penalty_points || 0}
                </span>
                {t.due_date && (
                  <span className="text-[9px] text-slate-400">
                    Due {new Date(t.due_date).toLocaleString('id-ID')}
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={busyId === t.id}
                onClick={() => handleComplete(t.id)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 rounded-xl"
              >
                {busyId === t.id ? 'Menyimpan…' : '✓ Tandai Selesai'}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
