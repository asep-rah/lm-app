import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback } from '@/lib/safeWrite';

type IssueForTask = {
  id: string;
  category?: string | null;
  description?: string | null;
  reporter_name?: string | null;
  urgency?: string | null;
};

const slaHoursOf = (urgency?: string | null) => {
  const u = String(urgency || '').toLowerCase();
  if (u.includes('critical') || u.includes('kritis')) return 4;
  if (u.includes('mendesak') || u.includes('urgent')) return 8;
  return 24;
};

/** Tugas SLA per role. Kegagalan satu role tidak membatalkan yang lain. */
export const createIssueTasksForRoles = async (
  issue: IssueForTask,
  roles: string[] = ['supervisor']
) => {
  if (!issue?.id) return { error: new Error('Issue id kosong'), taskIds: [] as string[] };

  const slaHours = slaHoursOf(issue.urgency);
  const due = new Date();
  due.setHours(due.getHours() + slaHours);
  const description = `${issue.reporter_name || 'Karyawan'}: ${issue.description || '-'}`;
  const taskIds: string[] = [];

  for (const role of roles) {
    const title =
      role === 'cs'
        ? `Komplain pelanggan — CS: ${issue.category || 'Kendala'}`
        : `Kendala Outlet: ${issue.category || 'Lainnya'}`;
    try {
      const res = await insertWithFallback<{ id: string }>(
        'system_tasks',
        [
          {
            title,
            description,
            assigned_to_role: role,
            sla_hours: slaHours,
            due_date: due.toISOString(),
            kpi_penalty_points: slaHours <= 4 ? 20 : 10,
            created_by_name: issue.reporter_name || 'Outlet',
            status: 'pending',
            source_type: 'OUTLET_ISSUE',
            source_id: issue.id
          },
          {
            title,
            description,
            assigned_to_role: role,
            sla_hours: slaHours,
            due_date: due.toISOString(),
            kpi_penalty_points: slaHours <= 4 ? 20 : 10,
            status: 'pending'
          },
          {
            title,
            description,
            assigned_to_role: role,
            status: 'pending'
          }
        ],
        { select: 'id' }
      );
      if (res.data?.[0]?.id) taskIds.push(res.data[0].id);
    } catch (e) {
      console.warn('system_tasks komplain:', e);
    }
  }

  if (taskIds[0]) {
    try {
      const { error: linkErr } = await supabase
        .from('outlet_issues')
        .update({ task_id: taskIds[0] })
        .eq('id', issue.id);
      if (linkErr) console.warn('Gagal menautkan task_id ke outlet_issues:', linkErr.message);
    } catch (e) {
      console.warn('Gagal menautkan task_id ke outlet_issues:', e);
    }
  }

  if (!taskIds.length) return { error: new Error('Task kosong'), taskIds };
  return { error: null, taskIds };
};

export const createSupervisorIssueTask = async (issue: IssueForTask) => {
  const res = await createIssueTasksForRoles(issue, ['supervisor']);
  return { error: res.error, taskId: res.taskIds[0] };
};
