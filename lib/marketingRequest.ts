/**
 * Pengajuan ke tim Digital Marketing, plus pemantauan Google Bisnis per outlet.
 *
 * Alur status dan jenis pengajuan hidup di sini, bukan di dalam komponen papan,
 * supaya label dan transisi yang sah tidak berbeda antara halaman marketing dan
 * inbox tugas.
 */

import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback, updateWithFallback } from '@/lib/safeWrite';
import { createIssueTasksForRoles } from '@/lib/createOutletIssueTask';

export const MARKETING_STATUS = {
  SUBMITTED: 'submitted',
  IN_PROGRESS: 'in_progress',
  WAITING_APPROVAL: 'waiting_approval',
  DONE: 'done',
  REJECTED: 'rejected'
} as const;

export type MarketingStatus = (typeof MARKETING_STATUS)[keyof typeof MARKETING_STATUS];

export const MARKETING_REQUEST_TYPES: {
  value: string;
  label: string;
  hint: string;
  /** Jam SLA yang dipakai saat membuat tugas. */
  slaHours: number;
}[] = [
  { value: 'google_ads', label: 'Google Ads', hint: 'Iklan pencarian / maps untuk outlet', slaHours: 24 },
  { value: 'design', label: 'Desain', hint: 'Banner, spanduk, konten sosial media', slaHours: 48 },
  { value: 'website_outlet', label: 'Outlet Baru di Website', hint: 'Tambah/perbarui halaman outlet', slaHours: 48 },
  { value: 'gbp_optimization', label: 'Optimasi Google Bisnis', hint: 'Foto, jam buka, balas review', slaHours: 72 }
];

export const marketingTypeLabel = (type: string) =>
  MARKETING_REQUEST_TYPES.find((t) => t.value === String(type || ''))?.label || String(type || '—');

export const MARKETING_STATUS_LABEL: Record<string, string> = {
  [MARKETING_STATUS.SUBMITTED]: 'Masuk',
  [MARKETING_STATUS.IN_PROGRESS]: 'Dikerjakan',
  [MARKETING_STATUS.WAITING_APPROVAL]: 'Menunggu Persetujuan',
  [MARKETING_STATUS.DONE]: 'Selesai',
  [MARKETING_STATUS.REJECTED]: 'Ditolak'
};

/**
 * Transisi yang sah. Sengaja satu arah kecuali "menunggu persetujuan" yang
 * boleh kembali dikerjakan bila pemohon minta revisi.
 */
const ALLOWED_NEXT: Record<string, MarketingStatus[]> = {
  [MARKETING_STATUS.SUBMITTED]: [MARKETING_STATUS.IN_PROGRESS, MARKETING_STATUS.REJECTED],
  [MARKETING_STATUS.IN_PROGRESS]: [MARKETING_STATUS.WAITING_APPROVAL, MARKETING_STATUS.DONE],
  [MARKETING_STATUS.WAITING_APPROVAL]: [MARKETING_STATUS.DONE, MARKETING_STATUS.IN_PROGRESS],
  [MARKETING_STATUS.DONE]: [],
  [MARKETING_STATUS.REJECTED]: []
};

export const nextStatuses = (status: string): MarketingStatus[] =>
  ALLOWED_NEXT[String(status || MARKETING_STATUS.SUBMITTED).toLowerCase()] || [];

export const canTransition = (from: string, to: string) =>
  nextStatuses(from).includes(String(to).toLowerCase() as MarketingStatus);

export const isMarketingOpen = (row: { status?: string | null }) => {
  const s = String(row?.status || '').toLowerCase();
  return s !== MARKETING_STATUS.DONE && s !== MARKETING_STATUS.REJECTED;
};

export type MarketingRequest = {
  id: string;
  type: string;
  outlet_id: string | null;
  requested_by_name: string | null;
  requested_by_role: string | null;
  brief: string | null;
  budget: number | null;
  target_date: string | null;
  assets: unknown[] | null;
  status: string;
  handled_by_name: string | null;
  result_note: string | null;
  result_url: string | null;
  task_id: string | null;
  created_at: string;
};

export const loadMarketingRequests = async (opts: {
  sinceIso?: string;
  outletIds?: string[];
  limit?: number;
}): Promise<MarketingRequest[]> => {
  let q = supabase
    .from('marketing_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.sinceIso) q = q.gte('created_at', opts.sinceIso);
  if (opts.outletIds?.length) q = q.in('outlet_id', opts.outletIds);

  const { data, error } = await q;
  if (error) {
    console.warn('marketing_requests:', error.message);
    return [];
  }
  return (data as MarketingRequest[]) || [];
};

/**
 * Buat pengajuan dan tugas untuk tim digital marketing sekaligus, supaya
 * pengajuan supervisor langsung muncul di inbox mereka dan terhitung SLA.
 *
 * Kegagalan membuat tugas tidak membatalkan pengajuan: pengajuan yang tercatat
 * tanpa tugas masih bisa dikerjakan, sedangkan kehilangan pengajuannya berarti
 * pemohon harus mengetik ulang.
 */
export const createMarketingRequest = async (opts: {
  type: string;
  outletId?: string | null;
  brief: string;
  budget?: number | null;
  targetDate?: string | null;
  requester: { name: string; role: string };
}) => {
  const typeMeta = MARKETING_REQUEST_TYPES.find((t) => t.value === opts.type);
  if (!typeMeta) return { error: { message: 'Jenis pengajuan tidak dikenali.' }, id: null };
  const brief = String(opts.brief || '').trim();
  if (!brief) return { error: { message: 'Brief wajib diisi.' }, id: null };

  const row = {
    type: opts.type,
    outlet_id: opts.outletId || null,
    requested_by_name: opts.requester.name,
    requested_by_role: opts.requester.role,
    brief,
    budget: opts.budget ?? null,
    target_date: opts.targetDate || null,
    status: MARKETING_STATUS.SUBMITTED
  };

  const ins = await insertWithFallback<{ id: string }>(
    'marketing_requests',
    [row, { type: row.type, brief, status: row.status }],
    { select: 'id' }
  );
  if (ins.error) return { error: ins.error, id: null };

  const id = ins.data?.[0]?.id || null;
  if (id) {
    const res = await createIssueTasksForRoles(
      {
        id,
        category: `${typeMeta.label}${opts.outletId ? '' : ' (pusat)'}`,
        description: brief,
        reporter_name: opts.requester.name,
        urgency: typeMeta.slaHours <= 24 ? 'mendesak' : 'normal'
      },
      ['digital_marketing']
    );
    if (res.taskIds[0]) {
      await updateWithFallback('marketing_requests', [{ task_id: res.taskIds[0] }], {
        column: 'id',
        value: id
      });
    }
  }

  return { error: null, id };
};

export const advanceMarketingRequest = async (opts: {
  req: MarketingRequest;
  to: string;
  handlerName?: string;
  resultNote?: string;
  resultUrl?: string;
}) => {
  if (!canTransition(opts.req.status, opts.to)) {
    return {
      error: {
        message: `Tidak bisa pindah dari ${MARKETING_STATUS_LABEL[opts.req.status] || opts.req.status} ke ${
          MARKETING_STATUS_LABEL[opts.to] || opts.to
        }.`
      }
    };
  }
  const full: Record<string, unknown> = {
    status: opts.to,
    handled_by_name: opts.handlerName || opts.req.handled_by_name || null,
    updated_at: new Date().toISOString()
  };
  if (opts.resultNote != null) full.result_note = opts.resultNote;
  if (opts.resultUrl != null) full.result_url = opts.resultUrl;

  return updateWithFallback('marketing_requests', [full, { status: opts.to }], {
    column: 'id',
    value: opts.req.id
  });
};

// ---------------------------------------------------------------------------
// Google Bisnis
// ---------------------------------------------------------------------------

export type GoogleSnapshot = {
  id: string;
  outlet_id: string;
  captured_at: string;
  rating: number | null;
  review_count: number | null;
  new_reviews: unknown[] | null;
  unreplied_count: number | null;
  snapshot_date: string | null;
};

/** Ambang penurunan rating yang dianggap perlu perhatian. */
export const RATING_DROP_ALERT = 0.1;

export type OutletGoogleStatus = {
  outletId: string;
  rating: number | null;
  reviewCount: number | null;
  /** Selisih rating terhadap snapshot terlama yang tersedia; null bila cuma ada satu. */
  ratingDelta: number | null;
  unreplied: number;
  capturedAt: string | null;
};

/**
 * Kondisi Google per outlet dari riwayat snapshot.
 *
 * Perubahan rating dihitung antara snapshot terbaru dan TERLAMA dalam rentang
 * yang dimuat, bukan terhadap kolom outlets.google_rating -- kolom itu adalah
 * nilai terkini yang sama, jadi membandingkannya dengan dirinya sendiri selalu
 * menghasilkan nol.
 */
export const googleStatusByOutlet = (snapshots: GoogleSnapshot[]): OutletGoogleStatus[] => {
  const byOutlet = new Map<string, GoogleSnapshot[]>();
  (snapshots || []).forEach((s) => {
    if (!s?.outlet_id) return;
    byOutlet.set(String(s.outlet_id), [...(byOutlet.get(String(s.outlet_id)) || []), s]);
  });

  const out: OutletGoogleStatus[] = [];
  byOutlet.forEach((rows, outletId) => {
    const sorted = [...rows].sort(
      (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    );
    const latest = sorted[0];
    const oldest = sorted[sorted.length - 1];
    const latestRating = latest?.rating == null ? null : Number(latest.rating);
    const oldestRating = oldest?.rating == null ? null : Number(oldest.rating);
    out.push({
      outletId,
      rating: latestRating,
      reviewCount: latest?.review_count == null ? null : Number(latest.review_count),
      ratingDelta:
        sorted.length > 1 && latestRating != null && oldestRating != null
          ? Number((latestRating - oldestRating).toFixed(2))
          : null,
      unreplied: Number(latest?.unreplied_count) || 0,
      capturedAt: latest?.captured_at || null
    });
  });

  return out;
};

/** Outlet yang ratingnya turun atau punya review belum dibalas. */
export const outletsNeedingAttention = (statuses: OutletGoogleStatus[]) =>
  statuses
    .filter((s) => (s.ratingDelta != null && s.ratingDelta <= -RATING_DROP_ALERT) || s.unreplied > 0)
    .sort((a, b) => (a.ratingDelta ?? 0) - (b.ratingDelta ?? 0) || b.unreplied - a.unreplied);

export const loadGoogleSnapshots = async (opts: {
  sinceDate: string;
  outletIds?: string[];
  limit?: number;
}): Promise<GoogleSnapshot[]> => {
  let q = supabase
    .from('outlet_google_snapshots')
    .select('*')
    .gte('snapshot_date', opts.sinceDate)
    .order('captured_at', { ascending: false })
    .limit(opts.limit ?? 1000);
  if (opts.outletIds?.length) q = q.in('outlet_id', opts.outletIds);

  const { data, error } = await q;
  if (error) {
    console.warn('outlet_google_snapshots:', error.message);
    return [];
  }
  return (data as GoogleSnapshot[]) || [];
};
