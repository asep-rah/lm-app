/**
 * Laporan supervisi outlet — definisi checklist, penilaian, dan tindak lanjut.
 *
 * Checklist dan bobotnya hidup di sini (satu sumber kebenaran), bukan di dalam
 * komponen form, supaya skor di halaman ringkasan dan di form tidak pernah
 * berbeda. Lihat AGENTS.md: aturan bisnis bukan milik UI.
 */

import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { createIssueTasksForRoles } from '@/lib/createOutletIssueTask';
import type { TaskAttachment } from '@/lib/taskReport';

export const VISIT_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  REVIEWED: 'reviewed'
} as const;

export type ChecklistVerdict = 'ok' | 'perlu_perbaikan' | 'buruk';

export const CHECKLIST_VERDICTS: { value: ChecklistVerdict; label: string; weight: number }[] = [
  { value: 'ok', label: 'Baik', weight: 1 },
  { value: 'perlu_perbaikan', label: 'Perlu Perbaikan', weight: 0.5 },
  { value: 'buruk', label: 'Buruk', weight: 0 }
];

/** Poin yang diperiksa supervisor saat kunjungan outlet. */
export const CHECKLIST_ITEMS: { key: string; label: string; hint: string }[] = [
  { key: 'kebersihan', label: 'Kebersihan Outlet', hint: 'Lantai, meja, area tunggu, toilet' },
  { key: 'mesin', label: 'Kondisi Mesin', hint: 'Washer, dryer, setrika — bunyi, bocor, error' },
  { key: 'stok', label: 'Stok Bahan', hint: 'Deterjen, pewangi, plastik, hanger' },
  { key: 'karyawan', label: 'Kedisiplinan Karyawan', hint: 'Kehadiran, seragam, pelayanan' },
  { key: 'antrian', label: 'Antrian & Kapasitas', hint: 'Cucian menumpuk, keterlambatan' },
  { key: 'administrasi', label: 'Administrasi & Kas', hint: 'Nota, setoran, pencatatan' }
];

const VERDICT_WEIGHT = new Map(CHECKLIST_VERDICTS.map((v) => [v.value, v.weight]));

export type Checklist = Record<string, ChecklistVerdict>;

export type VisitIssue = {
  category: string;
  description: string;
  urgency: string;
};

export type SupervisionVisit = {
  id: string;
  outlet_id: string | null;
  supervisor_id: string | null;
  supervisor_name: string | null;
  visit_date: string;
  checklist: Checklist | null;
  score: number | null;
  omset_note: string | null;
  omset_action_plan: string | null;
  staff_note: string | null;
  issues_found: VisitIssue[] | null;
  photos: TaskAttachment[] | null;
  follow_up_task_id: string | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
};

/**
 * Skor 0-100 dari poin yang benar-benar dinilai. Poin yang dilewati tidak
 * dihitung sebagai nol -- kunjungan singkat yang hanya memeriksa dua poin
 * tidak boleh terlihat seburuk outlet yang gagal di semua poin.
 * Mengembalikan null bila belum ada satu pun poin dinilai.
 */
export const visitScore = (checklist: Checklist | null | undefined): number | null => {
  const entries = Object.entries(checklist || {}).filter(([, v]) => VERDICT_WEIGHT.has(v));
  if (!entries.length) return null;
  const total = entries.reduce((sum, [, v]) => sum + (VERDICT_WEIGHT.get(v) ?? 0), 0);
  return Math.round((total / entries.length) * 100);
};

export const scoreTone = (score: number | null): 'emerald' | 'amber' | 'rose' | 'slate' => {
  if (score == null) return 'slate';
  if (score >= 80) return 'emerald';
  if (score >= 60) return 'amber';
  return 'rose';
};

/** Poin yang butuh perhatian, untuk ditawarkan sebagai temuan. */
export const failingItems = (checklist: Checklist | null | undefined) =>
  CHECKLIST_ITEMS.filter((item) => {
    const v = (checklist || {})[item.key];
    return v === 'perlu_perbaikan' || v === 'buruk';
  });

export const isVisitSubmitted = (visit: { status?: string | null }) =>
  String(visit?.status || '').toLowerCase() !== VISIT_STATUS.DRAFT;

/** Hari sejak kunjungan terakhir; null bila outlet belum pernah dikunjungi. */
export const daysSince = (isoDate: string | null | undefined, now = Date.now()): number | null => {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return null;
  return Math.floor((now - then) / 86400000);
};

export const loadVisits = async (opts: {
  outletIds?: string[];
  sinceDate?: string;
  limit?: number;
}): Promise<SupervisionVisit[]> => {
  const { outletIds, sinceDate, limit = 100 } = opts;
  let q = supabase
    .from('supervision_visits')
    .select('*')
    .order('visit_date', { ascending: false })
    .limit(limit);
  // Supervisor hanya melihat outlet yang menjadi tanggung jawabnya.
  if (outletIds?.length) q = q.in('outlet_id', outletIds);
  if (sinceDate) q = q.gte('visit_date', sinceDate);

  const { data, error } = await q;
  if (error) {
    console.warn('supervision_visits:', error.message);
    return [];
  }
  return (data as SupervisionVisit[]) || [];
};

/**
 * Simpan kunjungan. Temuan yang ditandai mendesak melahirkan tugas supervisor
 * lewat jalur yang sudah ada, supaya tindak lanjutnya ikut terhitung di KPI.
 */
export const saveVisit = async (opts: {
  visit: {
    id?: string;
    outlet_id: string;
    visit_date: string;
    checklist: Checklist;
    omset_note?: string;
    omset_action_plan?: string;
    staff_note?: string;
    issues_found?: VisitIssue[];
    photos?: TaskAttachment[];
  };
  session: { id: string; name: string };
  submit: boolean;
}) => {
  const { visit, session, submit } = opts;
  const now = new Date().toISOString();
  const issues = visit.issues_found || [];

  const row: Record<string, unknown> = {
    outlet_id: visit.outlet_id,
    supervisor_name: session.name,
    visit_date: visit.visit_date,
    checklist: visit.checklist,
    score: visitScore(visit.checklist),
    omset_note: visit.omset_note || null,
    omset_action_plan: visit.omset_action_plan || null,
    staff_note: visit.staff_note || null,
    issues_found: issues,
    photos: visit.photos || [],
    status: submit ? VISIT_STATUS.SUBMITTED : VISIT_STATUS.DRAFT,
    submitted_at: submit ? now : null
  };

  let visitId: string | null = visit.id || null;
  if (visit.id) {
    const upd = await updateWithFallback('supervision_visits', [row], { column: 'id', value: visit.id });
    if (upd.error) return { error: upd.error, visitId, taskId: null };
  } else {
    const ins = await insertWithFallback<{ id: string }>('supervision_visits', [row], { select: 'id' });
    if (ins.error) return { error: ins.error, visitId: null, taskId: null };
    visitId = ins.data?.[0]?.id || null;
  }

  // Tugas tindak lanjut hanya dibuat saat laporan dikirim, bukan saat draft
  // disimpan -- draft bisa disimpan berkali-kali dan akan menumpuk tugas.
  let taskId: string | null = null;
  if (submit && issues.length && visitId) {
    const urgent = issues.reduce(
      (acc, i) => (String(i.urgency || '').toLowerCase().includes('mendesak') ? i : acc),
      issues[0]
    );
    const res = await createIssueTasksForRoles(
      {
        id: visitId,
        category: urgent.category,
        description: issues.map((i) => `${i.category}: ${i.description}`).join(' | '),
        reporter_name: session.name,
        urgency: urgent.urgency
      },
      ['supervisor']
    );
    taskId = res.taskIds[0] || null;
    if (taskId) {
      await updateWithFallback('supervision_visits', [{ follow_up_task_id: taskId }], {
        column: 'id',
        value: visitId
      });
    }
  }

  return { error: null, visitId, taskId };
};
