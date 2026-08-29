/** Alias assigned_to_role di system_tasks -> kunci KPI 7 role. */

export const KPI_ROLE_ALIASES: Record<string, string[]> = {
  kasir: ['kasir', 'pos'],
  kurir_cs: ['cs', 'head_cs', 'cs_care', 'driver', 'courier', 'kurir'],
  supervisor: ['supervisor'],
  admin_ops: ['admin_ops', 'admin'],
  digital_marketing: ['digital_marketing'],
  finance: ['finance', 'head_finance'],
  owner_relation: ['owner_relation', 'owner']
};

/** Role login -> nilai assigned_to_role yang harus muncul di inbox orang itu. */
export const inboxRolesFor = (loginRole: string): string[] => {
  const r = String(loginRole || '').toLowerCase().trim();
  if (['kasir', 'pos'].includes(r)) return ['kasir', 'pos'];
  if (r === 'driver' || r === 'courier' || r === 'kurir') return ['driver', 'courier', 'kurir'];
  if (['cs', 'head_cs'].includes(r)) return ['cs', 'head_cs'];
  if (r === 'cs_care') return ['cs_care'];
  if (r === 'supervisor') return ['supervisor'];
  if (['finance', 'head_finance'].includes(r)) return ['finance', 'head_finance'];
  if (['admin_ops', 'admin'].includes(r)) return ['admin_ops', 'admin'];
  if (r === 'digital_marketing') return ['digital_marketing'];
  if (r === 'owner_relation') return ['owner_relation'];
  if (['head', 'head_management'].includes(r)) return ['head', 'head_management'];
  if (['owner'].includes(r)) return ['owner', 'owner_relation'];
  return r ? [r] : [];
};

/** Role tujuan tugas (target_role atau assigned_to_role). */
export const taskTargetRole = (item: any) =>
  String(item?.target_role || item?.assigned_to_role || '').toLowerCase().trim();

/** Owner melihat semua; role lain hanya tugas yang ditujukan ke rolenya. */
export const tasksVisibleForRole = (tasks: any[], loginRole: string) => {
  const r = String(loginRole || '').toLowerCase().trim();
  if (r === 'owner') return tasks;
  const aliases = new Set(inboxRolesFor(r));
  aliases.add(r);
  return (tasks || []).filter((item) => aliases.has(taskTargetRole(item)));
};

export const kpiRoleOfTask = (assignedTo: any): string | null => {
  const a = String(assignedTo || '').toLowerCase().trim();
  for (const [key, aliases] of Object.entries(KPI_ROLE_ALIASES)) {
    if (aliases.includes(a)) return key;
  }
  return null;
};

export const isTaskCompleted = (status: any) => {
  const s = String(status || '').toLowerCase().trim();
  return s === 'completed' || s === 'done' || s === 'selesai';
};

export const isTaskInProgress = (status: any) => {
  const s = String(status || '').toLowerCase().trim();
  return s === 'in_progress' || s === 'proses' || s === 'processing' || s.includes('proses');
};

export const isTaskOverdueOpen = (task: any, now = Date.now()) => {
  if (isTaskCompleted(task?.status)) return false;
  if (!task?.due_date) return false;
  const due = new Date(task.due_date).getTime();
  if (isNaN(due)) return false;
  return due < now;
};

export const overdueCountForRole = (tasks: any[], kpiKey: string, now = Date.now()) => {
  const aliases = KPI_ROLE_ALIASES[kpiKey] || [];
  return tasks
    .filter((t) => aliases.includes(String(t.assigned_to_role || '').toLowerCase()))
    .filter((t) => isTaskOverdueOpen(t, now)).length;
};

export const overduePenaltyForRole = (tasks: any[], kpiKey: string, now = Date.now()) => {
  const aliases = KPI_ROLE_ALIASES[kpiKey] || [];
  return tasks
    .filter((t) => aliases.includes(String(t.assigned_to_role || '').toLowerCase()))
    .filter((t) => isTaskOverdueOpen(t, now))
    .reduce((sum, t) => sum + Math.abs(Number(t.kpi_penalty_points) || 0), 0);
};
