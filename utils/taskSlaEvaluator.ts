import { supabase } from '@/lib/supabaseClient';

export const completeTaskWithSlaCheck = async (taskId: string, user: { id: string; name: string; role: string }) => {
  const now = new Date();

  // 1. Ambil Data Task
  const { data: task, error } = await supabase
    .from('system_tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (error || !task) return { success: false, message: 'Task tidak ditemukan' };

  const dueDate = new Date(task.due_date);
  const isOverdue = now > dueDate;
  const newStatus = isOverdue ? 'OVERDUE_COMPLETED' : 'COMPLETED';

  // 2. Update Status Task
  await supabase
    .from('system_tasks')
    .update({
      status: newStatus,
      completed_at: now.toISOString()
    })
    .eq('id', taskId);

  // 3. Jika Melewati SLA, Potong Poin KPI
  if (isOverdue) {
    const penalty = -Math.abs(task.kpi_penalty_points);
    await supabase.from('kpi_logs').insert([{
      employee_id: user.id,
      employee_name: user.name,
      role: user.role,
      source_type: 'TASK_SLA',
      score_change: penalty,
      reason: `Terlambat menyelesaikan tugas: "${task.title}" (Melewati SLA ${task.sla_hours} Jam)`
    }]);

    return { success: true, isOverdue: true, penalty };
  }

  // 4. Jika Tepat Waktu, Beri Poin Reward KPI (+5)
  await supabase.from('kpi_logs').insert([{
    employee_id: user.id,
    employee_name: user.name,
    role: user.role,
    source_type: 'TASK_SLA',
    score_change: 5,
    reason: `Tepat waktu menyelesaikan tugas: "${task.title}"`
  }]);

  return { success: true, isOverdue: false, reward: 5 };
};