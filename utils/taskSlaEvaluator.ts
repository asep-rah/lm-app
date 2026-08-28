import { supabase } from '@/lib/supabaseClient';

export const completeTaskWithSlaCheck = async (taskId: string, user: { id: string; name: string; role: string }) => {
  const now = new Date();

  const { data: task, error } = await supabase
    .from('system_tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (error || !task) return { success: false, message: 'Task tidak ditemukan' };

  const dueDate = new Date(task.due_date);
  const isOverdue = !isNaN(dueDate.getTime()) && now > dueDate;
  const newStatus = 'completed';
  const completedAt = now.toISOString();

  const first = await supabase
    .from('system_tasks')
    .update({ status: newStatus, completed_at: completedAt })
    .eq('id', taskId);

  if (first.error) {
    const retry = await supabase
      .from('system_tasks')
      .update({ status: newStatus })
      .eq('id', taskId);
    if (retry.error) {
      return { success: false, message: retry.error.message };
    }
  }

  const logRow = {
    employee_id: user.id,
    employee_name: user.name,
    role: user.role,
    source_type: 'TASK_SLA',
    score_change: isOverdue ? -Math.abs(task.kpi_penalty_points || 0) : 5,
    reason: isOverdue
      ? `Terlambat menyelesaikan tugas: "${task.title}" (Melewati SLA ${task.sla_hours} Jam)`
      : `Tepat waktu menyelesaikan tugas: "${task.title}"`
  };

  const { error: logErr } = await supabase.from('kpi_logs').insert([logRow]);
  if (logErr) console.warn('kpi_logs:', logErr.message);

  if (isOverdue) {
    return { success: true, isOverdue: true, penalty: -Math.abs(task.kpi_penalty_points || 0) };
  }

  return { success: true, isOverdue: false, reward: 5 };
};
