'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import {
  canAccessSettings,
  canAccessKpiSettings,
  canAccessFinanceRecon,
  getStaffSession,
  isHeadManagementRole
} from '@/lib/staffSession';
import { inboxRolesFor, isTaskCompleted, isTaskInProgress, isTaskOverdueOpen } from '@/lib/taskRoles';
import { roleLabelOf } from '@/lib/staffRoles';
import { completeTaskWithSlaCheck } from '@/utils/taskSlaEvaluator';
import HeadTaskDelegator from '@/components/HeadTaskDelegator';
import KpiRoleMonitoring from '@/components/KpiRoleMonitoring';
import FinanceWorkspacePanel from '@/components/FinanceWorkspacePanel';
import RequisitionForm from '@/components/RequisitionForm';
import { prAmount, prQty } from '@/lib/cmsRequisition';
import { toast } from '@/lib/toast';
import { updateWithFallback } from '@/lib/safeWrite';
import AICopilotCard from '@/components/analytics/AICopilotCard';
import WasherFraudAlertListener from '@/components/WasherFraudAlertListener';
import { parseIdList } from '@/lib/aiCopilotAnalytics';
import {
  SUPERVISOR_DECISIONS,
  complaintStepOf,
  isComplaintIssue,
  issueDescriptionPlain,
  issueResi,
  supervisorDecide
} from '@/lib/csCare';

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const priorityOf = (task: any) => {
  if (isTaskOverdueOpen(task)) return { label: 'Urgent', tone: 'rose' };
  if (Number(task.kpi_penalty_points) >= 10) return { label: 'High', tone: 'amber' };
  return { label: 'Normal', tone: 'slate' };
};

export default function StaffWorkspace() {
  const session = useMemo(() => getStaffSession(), []);
  const role = session.role;
  const supervisorAccessOutlets = useMemo(() => {
    try {
      const raw = localStorage.getItem('laundry_owner_user') || localStorage.getItem('laundry_user');
      const u = raw ? JSON.parse(raw) : {};
      return parseIdList(u.access_outlets);
    } catch {
      return [];
    }
  }, []);
  const aliases = inboxRolesFor(role);

  const [tasks, setTasks] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [promos, setPromos] = useState<any[]>([]);
  const [investorNotes, setInvestorNotes] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [unassignedChats, setUnassignedChats] = useState(0);
  const [outletCaps, setOutletCaps] = useState<any[]>([]);
  const [outletNames, setOutletNames] = useState<Record<string, string>>({});
  const [capBusy, setCapBusy] = useState<string | null>(null);
  const [supNote, setSupNote] = useState('');
  const [supBusy, setSupBusy] = useState<string | null>(null);

  const loadTasks = async () => {
    if (!aliases.length) {
      setTasks([]);
      return;
    }
    const { data, error } = await supabase
      .from('system_tasks')
      .select('*')
      .in('assigned_to_role', aliases)
      .order('due_date', { ascending: true })
      .limit(80);
    if (error) {
      console.warn('workspace tasks:', error.message);
      setTasks([]);
      return;
    }
    setTasks(data || []);
  };

  const loadContext = async () => {
    if (role === 'digital_marketing') {
      const { data } = await supabase.from('promos').select('*').order('created_at', { ascending: false }).limit(8);
      setPromos(data || []);
    }
    if (role === 'owner_relation') {
      const { data } = await supabase
        .from('support_chats')
        .select('id, message, customer_phone, created_at, sender_type')
        .eq('sender_type', 'investor')
        .order('created_at', { ascending: false })
        .limit(8);
      setInvestorNotes(data || []);
    }
    if (role === 'supervisor') {
      const { data } = await supabase.from('outlet_issues').select('*').order('created_at', { ascending: false }).limit(40);
      setIssues((data || []).filter((i: any) => String(i.status || '').toLowerCase() !== 'selesai' && complaintStepOf(i) !== 'resolved'));
      const { data: outs } = await supabase.from('outlets').select('id, name, is_overcapacity').order('name');
      setOutletCaps(outs || []);
    }
    const { data: outs } = await supabase.from('outlets').select('id, name');
    setOutletNames(Object.fromEntries((outs || []).map((o: any) => [o.id, o.name])));
    if (role === 'cs' || role === 'head_cs' || role === 'cs_care') {
      const { count } = await supabase
        .from('support_chat_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('is_claimed', false);
      setUnassignedChats(count || 0);
    }
  };

  useEffect(() => {
    loadTasks();
    loadContext();
    const channel = supabase
      .channel('workspace_tasks_' + role)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_tasks' }, () => loadTasks())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const openTasks = tasks.filter((t) => !isTaskCompleted(t.status));
  const completedToday = tasks.filter((t) => {
    if (!isTaskCompleted(t.status)) return false;
    const ts = t.completed_at || t.due_date;
    if (!ts) return false;
    return new Date(ts).getTime() >= todayStart();
  }).length;
  const pendingSla = openTasks.filter((t) => isTaskOverdueOpen(t)).length;

  const visible = openTasks.filter((t) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      String(t.title || '').toLowerCase().includes(q) ||
      String(t.description || '').toLowerCase().includes(q)
    );
  });

  const markProcess = async (task: any) => {
    setBusyId(task.id);
    const { error } = await supabase.from('system_tasks').update({ status: 'in_progress' }).eq('id', task.id);
    setBusyId(null);
    if (error) {
      toast('Gagal ubah status: ' + error.message, 'err');
      return;
    }
    toast('Tugas masuk proses.', 'ok');
    loadTasks();
  };

  const markDone = async (taskId: string) => {
    setBusyId(taskId);
    const res = await completeTaskWithSlaCheck(taskId, {
      id: session.id || session.name,
      name: session.name,
      role
    });
    setBusyId(null);
    if (!res.success) {
      toast(res.message || 'Gagal menyelesaikan tugas', 'err');
      return;
    }
    toast(res.isOverdue ? `Selesai, SLA terlewati (−${Math.abs(res.penalty || 0)})` : 'Tugas selesai.', res.isOverdue ? 'warn' : 'ok');
    loadTasks();
  };

  const handleSupervisorDecision = async (issue: any, decision: string) => {
    setSupBusy(`${issue.id}-${decision}`);
    try {
      const { error } = await supervisorDecide({
        issue,
        decision,
        note: supNote,
        agentName: session.name
      });
      if (error) {
        toast(error.message, 'err');
        return;
      }
      toast(`Keputusan ${SUPERVISOR_DECISIONS.find((d) => d.value === decision)?.label} dikirim ke CS Care.`, 'ok');
      setSupNote('');
      loadContext();
    } finally {
      setSupBusy(null);
    }
  };

  const toggleOutletCapacity = async (outlet: any) => {
    setCapBusy(outlet.id);
    const next = !outlet.is_overcapacity;
    const { error } = await updateWithFallback(
      'outlets',
      [{ is_overcapacity: next }],
      { column: 'id', value: outlet.id }
    );
    setCapBusy(null);
    if (error) {
      toast('Gagal mengubah kapasitas: ' + error.message, 'err');
      return;
    }
    setOutletCaps((prev) => prev.map((o) => (o.id === outlet.id ? { ...o, is_overcapacity: next } : o)));
    toast(next ? `${outlet.name} disembunyikan dari pelanggan.` : `${outlet.name} kembali dibuka.`, 'ok');
  };

  const handleLogout = () => {
    localStorage.removeItem('laundry_user');
    localStorage.removeItem('laundry_owner_user');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
            <h1 className="text-lg font-semibold tracking-tight truncate">{session.name}</h1>
            <p className="text-[11px] text-slate-500">{roleLabelOf(role)}</p>
          </div>
          <div className="flex gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 min-w-[88px]">
              <p className="text-[9px] uppercase font-bold text-slate-400">Assigned</p>
              <p className="text-lg font-semibold tabular-nums">{openTasks.length}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 min-w-[88px]">
              <p className="text-[9px] uppercase font-bold text-amber-600">Pending SLA</p>
              <p className="text-lg font-semibold tabular-nums text-amber-800">{pendingSla}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 min-w-[88px]">
              <p className="text-[9px] uppercase font-bold text-emerald-600">Selesai hari ini</p>
              <p className="text-lg font-semibold tabular-nums text-emerald-800">{completedToday}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canAccessSettings(role) && (
              <Link href="/owner" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
                Analytics
              </Link>
            )}
            <Link href="/history" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
              Transaksi
            </Link>
            {canAccessKpiSettings(role) && (
              <Link href="/owner/kpi-settings" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
                KPI Settings
              </Link>
            )}
            {(role === 'cs' || role === 'head_cs' || role === 'cs_care') && (
              <>
                <Link href="/cs" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-sky-600 text-white">
                  Command Center
                </Link>
                <Link href="/cs/care" className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white">
                  CS Care
                </Link>
              </>
            )}
            <button type="button" onClick={handleLogout} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-rose-600 border border-rose-100 hover:bg-rose-50">
              Keluar
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        {role === 'supervisor' && <WasherFraudAlertListener />}
        {(role === 'supervisor' || role === 'finance' || role === 'head_finance' || role === 'head' || role === 'head_management') && (
          <AICopilotCard
            scope="supervisor"
            outletId={session.outletId || 'ALL'}
            period="THIS_MONTH"
            supervisorName={session.name}
            accessOutlets={supervisorAccessOutlets}
          />
        )}
        {(role === 'admin_ops' || role === 'admin') && (
          <section className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <RequisitionForm employeeName={session.name} role={role} selectedOutlet={session.outletId || undefined} />
          </section>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-7 bg-white border border-slate-200/80 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col min-h-[70vh]">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Task Inbox & Focus Board</h2>
              <p className="text-[11px] text-slate-400">Cari, proses, lalu tandai selesai.</p>
            </div>
          </div>
          <div className="px-4 py-2 border-b border-slate-100">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari tugas…"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {visible.length === 0 && (
              <div className="text-center py-16 text-slate-400 text-sm">Inbox kosong. Tidak ada tugas terbuka.</div>
            )}
            {visible.map((t) => {
              const pri = priorityOf(t);
              const processing = isTaskInProgress(t.status);
              return (
                <article key={t.id} className="rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition-colors bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900 leading-snug">{t.title}</p>
                    <span
                      className={`shrink-0 text-[9px] font-bold uppercase px-2 py-0.5 rounded-md ${
                        pri.tone === 'rose'
                          ? 'bg-rose-50 text-rose-700'
                          : pri.tone === 'amber'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {pri.label}
                    </span>
                  </div>
                  {t.description && <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">{t.description}</p>}
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                    <div className="rounded-lg bg-slate-50 px-2 py-1">
                      <p className="text-slate-400 font-bold uppercase">Qty</p>
                      <p className="font-semibold text-slate-800">{prQty(t) || t.quantity || '—'}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1">
                      <p className="text-slate-400 font-bold uppercase">Outlet</p>
                      <p className="font-semibold text-slate-800 truncate">{outletNames[t.outlet_id] || t.outlet_name || '—'}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1">
                      <p className="text-slate-400 font-bold uppercase">Budget</p>
                      <p className="font-semibold text-slate-800">
                        {prAmount(t) || Number(t.estimated_cost || t.amount || 0)
                          ? `Rp ${Number(prAmount(t) || t.estimated_cost || t.amount || 0).toLocaleString('id-ID')}`
                          : '—'}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">
                    {t.assigned_to_role}
                    {t.due_date ? ` · due ${new Date(t.due_date).toLocaleString('id-ID')}` : ''}
                    {t.sla_hours ? ` · SLA ${t.sla_hours}j` : ''}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      disabled={busyId === t.id || processing}
                      onClick={() => markProcess(t)}
                      className="flex-1 text-[11px] font-semibold py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {processing ? 'Sedang proses' : 'Proses'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => markDone(t.id)}
                      className="flex-1 text-[11px] font-semibold py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                    >
                      {busyId === t.id ? '…' : 'Tandai Selesai'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h2 className="text-sm font-semibold mb-1">Quick Activity & Context</h2>
            <p className="text-[11px] text-slate-400 mb-3">Panel sesuai alur kerja role Anda.</p>

            {(role === 'digital_marketing') && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Campaign / redemption</p>
                {promos.length === 0 && <p className="text-xs text-slate-400">Belum ada promo.</p>}
                {promos.map((p) => (
                  <div key={p.id} className="flex justify-between text-xs border border-slate-100 rounded-lg px-2.5 py-2">
                    <span className="font-semibold">{p.code || p.title || 'Promo'}</span>
                    <span className="text-slate-500">
                      {Number(p.used_count || 0)}/{p.max_quota || '∞'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {role === 'owner_relation' && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Query investor</p>
                {investorNotes.length === 0 && <p className="text-xs text-slate-400">Belum ada pesan investor.</p>}
                {investorNotes.map((n) => (
                  <div key={n.id} className="text-xs border border-slate-100 rounded-lg px-2.5 py-2">
                    <p className="font-medium text-slate-800 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{n.customer_phone}</p>
                  </div>
                ))}
              </div>
            )}

            {canAccessFinanceRecon(role) && <FinanceWorkspacePanel />}

            {(role === 'admin_ops' || role === 'admin') && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">CMS Approval & Fulfillment</p>
                <p className="text-[11px] text-slate-500">Pending → Approved → Paid → Fulfilled. Export untuk log restock.</p>
              </div>
            )}

            {role === 'supervisor' && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Kapasitas outlet</p>
                <p className="text-[11px] text-slate-500">Outlet penuh disembunyikan dari pilihan pelanggan.</p>
                {outletCaps.length === 0 && <p className="text-xs text-slate-400">Outlet belum dimuat.</p>}
                {outletCaps.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 text-xs border border-slate-100 rounded-lg px-2.5 py-2">
                    <span className="font-semibold truncate">{o.name}</span>
                    <button
                      type="button"
                      disabled={capBusy === o.id}
                      onClick={() => toggleOutletCapacity(o)}
                      className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-md ${
                        o.is_overcapacity ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {o.is_overcapacity ? 'Penuh — buka lagi' : 'Tandai penuh'}
                    </button>
                  </div>
                ))}
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 pt-2">Persetujuan komplain</p>
                {issues.filter((i) => isComplaintIssue(i) && complaintStepOf(i) === 'pending_supervisor').length === 0 && (
                  <p className="text-xs text-slate-400">Tidak ada komplain menunggu keputusan.</p>
                )}
                {issues
                  .filter((i) => isComplaintIssue(i) && complaintStepOf(i) === 'pending_supervisor')
                  .map((i) => (
                    <div key={i.id} className="text-xs border border-amber-100 bg-amber-50/50 rounded-lg px-2.5 py-2 space-y-2">
                      <p className="font-semibold">{issueResi(i)}</p>
                      <p className="text-slate-600 line-clamp-3">{issueDescriptionPlain(i)}</p>
                      {i.findings && <p className="text-indigo-800">Temuan: {i.findings}</p>}
                      {i.cctv_notes && <p className="text-slate-500">CCTV: {i.cctv_notes}</p>}
                      <input
                        value={supNote}
                        onChange={(e) => setSupNote(e.target.value)}
                        placeholder="Catatan Supervisor (opsional)"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white"
                      />
                      <div className="grid grid-cols-3 gap-1">
                        {SUPERVISOR_DECISIONS.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            disabled={supBusy === `${i.id}-${d.value}`}
                            onClick={() => handleSupervisorDecision(i, d.value)}
                            className={`text-[9px] font-black py-1.5 rounded-md ${
                              d.value === 'reject'
                                ? 'bg-rose-600 text-white'
                                : d.value === 'cash'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-indigo-600 text-white'
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 pt-2">Kendala outlet</p>
                {issues.filter((i) => !isComplaintIssue(i)).length === 0 && <p className="text-xs text-slate-400">Tidak ada issue terbuka.</p>}
                {issues.filter((i) => !isComplaintIssue(i)).map((i) => (
                  <div key={i.id} className="text-xs border border-slate-100 rounded-lg px-2.5 py-2">
                    <p className="font-semibold">{i.category || 'Issue'}</p>
                    <p className="text-slate-500 line-clamp-2">{i.description}</p>
                  </div>
                ))}
                <Link href="/owner" className="block text-center text-[11px] font-semibold py-2 rounded-lg border border-slate-200">
                  Buka analytics & settings
                </Link>
              </div>
            )}

            {isHeadManagementRole(role) && <HeadTaskDelegator />}

            {(role === 'cs' || role === 'head_cs' || role === 'cs_care') && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Antrian chat</p>
                <p className="text-2xl font-semibold tabular-nums">{unassignedChats}</p>
                <p className="text-xs text-slate-500">thread belum di-claim</p>
                <Link href="/cs" className="block text-center text-xs font-semibold py-2 rounded-lg bg-sky-600 text-white">
                  Buka Command Center
                </Link>
                <Link href="/cs/care" className="block text-center text-xs font-semibold py-2 rounded-lg bg-rose-600 text-white">
                  Inbox CS Care
                </Link>
                <Link href="/cs/dashboard" className="block text-center text-[11px] font-semibold py-2 rounded-lg border border-slate-200">
                  Ops dashboard
                </Link>
              </div>
            )}
          </div>
          <KpiRoleMonitoring />
        </aside>
        </div>
      </main>
    </div>
  );
}
