/**
 * Laporan penyelesaian tugas + utas komentar.
 *
 * Penilaian SLA/KPI tetap milik utils/taskSlaEvaluator -- di sini hanya
 * melampirkan laporannya lebih dulu, supaya isi laporan tidak hilang kalau
 * penilaian KPI gagal.
 */

import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { uploadProofFile } from '@/lib/uploadProof';
import { completeTaskWithSlaCheck } from '@/utils/taskSlaEvaluator';

export type TaskAttachment = { url: string; name: string; type: string };

export type TaskComment = {
  id: string;
  task_id: string;
  author_name: string | null;
  author_role: string | null;
  body: string | null;
  attachments: TaskAttachment[] | null;
  created_at: string;
};

export const MAX_ATTACHMENTS = 5;

/** session.id bisa berisi username, sedangkan kolom author_id bertipe uuid. */
const asUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim())
    ? String(value).trim()
    : null;

/** uploadProofFile tidak melempar untuk gambar; video bisa gagal dan itu dilaporkan. */
export const uploadTaskAttachments = async (
  files: File[],
  prefix = 'task'
): Promise<{ attachments: TaskAttachment[]; failed: string[] }> => {
  const attachments: TaskAttachment[] = [];
  const failed: string[] = [];
  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    try {
      const url = await uploadProofFile(file, prefix);
      attachments.push({ url, name: file.name, type: file.type || 'application/octet-stream' });
    } catch {
      failed.push(file.name);
    }
  }
  return { attachments, failed };
};

/**
 * completeTaskWithSlaCheck menyimpulkan tipe balikannya tanpa diskriminan,
 * sehingga pemanggil tidak bisa mempersempitnya lewat `if (!res.success)`.
 * Bentuk eksplisit ini yang dipakai UI.
 */
export type TaskReportResult =
  | { success: false; message: string; isOverdue?: undefined; penalty?: undefined }
  | { success: true; isOverdue: boolean; penalty?: number; reward?: number; message?: string };

/**
 * Simpan laporan lalu tandai selesai. Kolom report_note/attachments baru ada
 * setelah migrasi 20260920; bila belum, laporan gagal disimpan tapi tugas
 * TIDAK ikut ditutup -- lebih baik gagal terang daripada tugas selesai tanpa
 * laporan yang diminta.
 */
export const submitTaskReport = async (opts: {
  task: { id: string };
  note: string;
  attachments: TaskAttachment[];
  session: { id: string; name: string; role: string };
}): Promise<TaskReportResult> => {
  const { task, note, attachments, session } = opts;

  const saved = await updateWithFallback(
    'system_tasks',
    [{ report_note: note || null, attachments }],
    { column: 'id', value: task.id }
  );
  if (saved.error) return { success: false, message: `Laporan gagal disimpan: ${saved.error.message}` };

  const res = await completeTaskWithSlaCheck(task.id, {
    id: session.id || session.name,
    name: session.name,
    role: session.role
  });
  if (!res.success) return { success: false, message: res.message || 'Gagal menyelesaikan tugas' };
  return { success: true, isOverdue: Boolean(res.isOverdue), penalty: res.penalty, reward: res.reward };
};

export const loadTaskComments = async (taskId: string): Promise<TaskComment[]> => {
  const { data, error } = await supabase
    .from('task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) {
    console.warn('task_comments:', error.message);
    return [];
  }
  return (data as TaskComment[]) || [];
};

export const addTaskComment = async (opts: {
  taskId: string;
  body: string;
  attachments?: TaskAttachment[];
  session: { id: string; name: string; role: string };
}) => {
  const { taskId, body, attachments = [], session } = opts;
  const row = {
    task_id: taskId,
    author_name: session.name,
    author_role: session.role,
    body: body || null,
    attachments
  };
  return insertWithFallback('task_comments', [
    { ...row, author_id: asUuid(session.id) },
    row,
    { task_id: taskId, author_name: session.name, body: body || null }
  ]);
};
