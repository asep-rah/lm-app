'use client';

import { useEffect, useState } from 'react';
import OwnerExecNav from '@/components/OwnerExecNav';
import HeadTaskDelegator from '@/components/HeadTaskDelegator';
import SupervisorComplaintPanel from '@/components/SupervisorComplaintPanel';
import { supabase } from '@/lib/supabaseClient';
import { getStaffSession, canAccessSettings, homePathForRole, isOwnerRole, isWorkspaceRole } from '@/lib/staffSession';
import { isTaskCompleted, isTaskOverdueOpen, tasksVisibleForRole } from '@/lib/taskRoles';
import { completeTaskWithSlaCheck } from '@/utils/taskSlaEvaluator';
import StatusBadge from '@/components/ui/StatusBadge';

const progressOf = (task: any) => {
  if (isTaskCompleted(task.status)) return { label: 'Selesai', tone: 'emerald' as const };
  if (isTaskOverdueOpen(task)) return { label: 'Overdue', tone: 'rose' as const };
  const st = String(task.status || '').toLowerCase();
  if (st.includes('proses') || st.includes('progress')) return { label: 'Proses', tone: 'amber' as const };
  return { label: 'Pending', tone: 'slate' as const };
};

export default function OwnerDelegasiPage() {
  const session = getStaffSession();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from('system_tasks')
      .select('*')
      .order('due_date', { ascending: true })
      .limit(200);
    if (error) {
      console.warn('system_tasks:', error.message);
      setTasks([]);
      return;
    }
    const viewerRole = String(role || getStaffSession().role || '').toLowerCase();
    setTasks(tasksVisibleForRole(data || [], viewerRole));
  };

  useEffect(() => {
    const raw = localStorage.getItem('laundry_owner_user');
    if (!raw) {
      window.location.href = '/login';
      return;
    }
    const user = JSON.parse(raw);
    const r = String(user.role || '').toLowerCase();
    if (isWorkspaceRole(r) && !canAccessSettings(r)) {
      window.location.href = '/workspace';
      return;
    }
    if (!canAccessSettings(r) && !isOwnerRole(r)) {
      window.location.href = homePathForRole(r);
      return;
    }
    setName(user.name || '');
    setRole(r);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    const ch = supabase
      .channel('owner_delegasi_tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_tasks' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [ready]);

  const handleComplete = async (taskId: string) => {
    setBusyId(taskId);
    const res = await completeTaskWithSlaCheck(taskId, {
      id: session.id || session.name,
      name: session.name || name,
      role: session.role || role
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

  if (!ready) return <div className="min-h-screen bg-slate-50" />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white border border-slate-200/80 p-5 md:p-6 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Owner Analytics</p>
            <h1 className="text-2xl font-black text-slate-900 mt-0.5">Delegasi Tugas & Control SLA</h1>
            <p className="text-xs text-slate-400 mt-0.5">Tugas manajemen, batas waktu, dan aksi penyelesaian</p>
          </div>
          <OwnerExecNav active="delegasi" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HeadTaskDelegator />
          {['owner', 'supervisor'].includes(role) && <SupervisorComplaintPanel agentName={name} />}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-sm font-black text-slate-900">Daftar Tugas & SLA</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {tasks.filter((t) => !isTaskCompleted(t.status)).length} aktif
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Judul Tugas</th>
                  <th className="p-3">Role Tujuan</th>
                  <th className="p-3">Batas Waktu SLA</th>
                  <th className="p-3">Status Progress</th>
                  <th className="p-3 text-right">Aksi / Selesaikan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      Belum ada tugas delegasi.
                    </td>
                  </tr>
                )}
                {tasks.map((t) => {
                  const prog = progressOf(t);
                  const done = isTaskCompleted(t.status);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="p-3">
                        <p className="font-black text-slate-900">{t.title || '—'}</p>
                        {t.description ? <p className="text-[11px] text-slate-500 mt-0.5 max-w-md whitespace-normal">{t.description}</p> : null}
                      </td>
                      <td className="p-3 font-bold uppercase text-indigo-700">{t.target_role || t.assigned_to_role || '—'}</td>
                      <td className="p-3">
                        <p className="font-semibold text-slate-800">
                          {t.due_date ? new Date(t.due_date).toLocaleString('id-ID') : '—'}
                        </p>
                        <p className="text-[10px] text-slate-400">{t.sla_hours || '—'} jam · penalti -{t.kpi_penalty_points || 0}</p>
                      </td>
                      <td className="p-3">
                        <StatusBadge tone={prog.tone}>{prog.label}</StatusBadge>
                      </td>
                      <td className="p-3 text-right">
                        {done ? (
                          <span className="text-[11px] font-bold text-emerald-600">Selesai</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === t.id}
                            onClick={() => handleComplete(t.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-3 py-1.5 rounded-lg text-[11px] disabled:opacity-50"
                          >
                            {busyId === t.id ? 'Menyimpan…' : 'Selesaikan'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
