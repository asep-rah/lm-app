import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback } from '@/lib/safeWrite';

type IssueForTask = {
  id: string;
  category?: string | null;
  description?: string | null;
  reporter_name?: string | null;
  urgency?: string | null;
};

/**
 * Setiap laporan kendala outlet otomatis jadi tugas SLA Supervisor.
 * Kegagalan pembuatan task tidak boleh membatalkan laporan yang sudah tersimpan.
 */
export const createSupervisorIssueTask = async (issue: IssueForTask) => {
  if (!issue?.id) return { error: new Error('Issue id kosong') };

  const urgency = String(issue.urgency || '').toLowerCase();
  const slaHours = urgency.includes('critical') || urgency.includes('kritis')
    ? 4
    : urgency.includes('mendesak') || urgency.includes('urgent')
    ? 8
    : 24;

  const due = new Date();
  due.setHours(due.getHours() + slaHours);

  const title = `Kendala Outlet: ${issue.category || 'Lainnya'}`;
  const description = `${issue.reporter_name || 'Karyawan'}: ${issue.description || '-'}`;

  let data: { id: string }[] | null = null;
  let error: { message: string } | null = null;
  try {
    const res = await insertWithFallback<{ id: string }>('system_tasks', [
      {
        title,
        description,
        assigned_to_role: 'supervisor',
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
        assigned_to_role: 'supervisor',
        sla_hours: slaHours,
        due_date: due.toISOString(),
        kpi_penalty_points: slaHours <= 4 ? 20 : 10,
        status: 'pending'
      },
      {
        title,
        description,
        assigned_to_role: 'supervisor',
        status: 'pending'
      }
    ], { select: 'id' });
    data = res.data;
    error = res.error;
  } catch (e: unknown) {
    error = { message: e instanceof Error ? e.message : 'Failed to fetch' };
  }

  if (error || !data?.[0]?.id) {
    console.error('Gagal membuat system_tasks dari outlet_issues:', error?.message);
    return { error: error || new Error('Task kosong') };
  }

  const taskId = data[0].id;
  try {
    const { error: linkErr } = await supabase
      .from('outlet_issues')
      .update({ task_id: taskId })
      .eq('id', issue.id);
    if (linkErr) console.warn('Gagal menautkan task_id ke outlet_issues:', linkErr.message);
  } catch (e) {
    console.warn('Gagal menautkan task_id ke outlet_issues:', e);
  }

  return { error: null, taskId };
};
