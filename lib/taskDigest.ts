/**
 * Ringkasan tugas untuk notifikasi terjadwal (dipanggil n8n).
 *
 * Murni — tidak menyentuh jaringan — supaya ambang "segera jatuh tempo" bisa
 * diuji tanpa database. Definisi "terlambat" memakai isTaskOverdueOpen yang
 * sudah dipakai KPI, bukan aturan baru: tugas yang dihitung terlambat di
 * notifikasi harus sama dengan yang terlambat di penilaian KPI.
 */

import { isTaskCompleted, isTaskOverdueOpen, taskTargetRole } from '@/lib/taskRoles';
import {
  isPrApprovedAwaiting,
  isPrAwaitingOwner,
  isPrPending,
  prAmount,
  prTitle
} from '@/lib/cmsRequisition';

/** Batas "segera jatuh tempo" dalam jam. */
export const DUE_SOON_HOURS = 12;

export type DigestTask = {
  id: string;
  title: string;
  role: string;
  dueDate: string | null;
  hoursLeft: number | null;
  assignedEmployeeId: string | null;
};

const toDigest = (task: any, now: number): DigestTask => {
  const due = task?.due_date ? new Date(task.due_date).getTime() : NaN;
  return {
    id: String(task?.id || ''),
    title: String(task?.title || 'Tugas'),
    role: taskTargetRole(task),
    dueDate: task?.due_date || null,
    hoursLeft: isNaN(due) ? null : Math.round(((due - now) / 3_600_000) * 10) / 10,
    assignedEmployeeId: task?.assigned_to_employee_id ? String(task.assigned_to_employee_id) : null
  };
};

/**
 * Tugas yang akan jatuh tempo dalam `hours` ke depan dan belum selesai.
 * Yang sudah terlambat TIDAK masuk sini — itu kategori terpisah, supaya satu
 * tugas tidak dinotifikasi dua kali dengan nada berbeda.
 */
export const dueSoonTasks = (tasks: any[], now = Date.now(), hours = DUE_SOON_HOURS): DigestTask[] =>
  (tasks || [])
    .filter((t) => {
      if (isTaskCompleted(t?.status)) return false;
      const due = t?.due_date ? new Date(t.due_date).getTime() : NaN;
      if (isNaN(due)) return false;
      return due >= now && due - now <= hours * 3_600_000;
    })
    .map((t) => toDigest(t, now))
    .sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0));

export const overdueTasks = (tasks: any[], now = Date.now()): DigestTask[] =>
  (tasks || [])
    .filter((t) => isTaskOverdueOpen(t, now))
    .map((t) => toDigest(t, now))
    .sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0));

/** Jumlah tugas terbuka per role, untuk ringkasan harian. */
export const openCountByRole = (tasks: any[]): Record<string, number> => {
  const out: Record<string, number> = {};
  (tasks || []).forEach((t) => {
    if (isTaskCompleted(t?.status)) return;
    const role = taskTargetRole(t) || '(tanpa role)';
    out[role] = (out[role] || 0) + 1;
  });
  return out;
};

export type TaskDigest = {
  generatedAt: string;
  dueSoonHours: number;
  dueSoon: DigestTask[];
  overdue: DigestTask[];
  openByRole: Record<string, number>;
};

export const buildTaskDigest = (
  tasks: any[],
  now = Date.now(),
  hours = DUE_SOON_HOURS
): TaskDigest => ({
  generatedAt: new Date(now).toISOString(),
  dueSoonHours: hours,
  dueSoon: dueSoonTasks(tasks, now, hours),
  overdue: overdueTasks(tasks, now),
  openByRole: openCountByRole(tasks)
});

// ---------------------------------------------------------------------------
// Antrean pengajuan.
//
// Angka saja tidak cukup untuk n8n: untuk mengirim permintaan approval lewat
// WhatsApp ia butuh ID pengajuannya, bukan sekadar tahu ada tiga yang menunggu.
// ---------------------------------------------------------------------------

export type RequisitionBrief = {
  id: string;
  title: string;
  amount: number;
  ageHours: number | null;
};

const toBrief = (pr: any, now: number): RequisitionBrief => {
  const created = pr?.created_at ? new Date(pr.created_at).getTime() : NaN;
  return {
    id: String(pr?.id || ''),
    title: prTitle(pr),
    amount: prAmount(pr),
    ageHours: isNaN(created) ? null : Math.round(((now - created) / 3_600_000) * 10) / 10
  };
};

/** Paling lama menunggu lebih dulu; itu yang paling perlu didorong. */
const oldestFirst = (a: RequisitionBrief, b: RequisitionBrief) => (b.ageHours ?? 0) - (a.ageHours ?? 0);

export type RequisitionQueue = {
  pendingApproval: RequisitionBrief[];
  awaitingAdminOpsVerification: number;
  awaitingOwnerPayment: RequisitionBrief[];
};

/**
 * Pisahkan pengajuan menurut siapa yang sedang ditunggu.
 *
 * Tahap verifikasi Admin Ops hanya dihitung, tidak dirinci: tidak ada aksi
 * WhatsApp untuk tahap itu, dan mengirim daftarnya keluar berarti membocorkan
 * rincian pengeluaran tanpa ada yang bisa dilakukan atasnya.
 */
export const buildRequisitionQueue = (prs: any[], now = Date.now()): RequisitionQueue => ({
  pendingApproval: (prs || []).filter(isPrPending).map((pr) => toBrief(pr, now)).sort(oldestFirst),
  awaitingAdminOpsVerification: (prs || []).filter(isPrApprovedAwaiting).length,
  awaitingOwnerPayment: (prs || []).filter(isPrAwaitingOwner).map((pr) => toBrief(pr, now)).sort(oldestFirst)
});
