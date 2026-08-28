// Sumber tunggal untuk pemetaan tahap pengerjaan + timeline waktu & crew.
// Dipakai bersama oleh POS, Owner, halaman Track publik, dan dashboard customer
// supaya tidak ada lagi logika pencocokan tahap yang berbeda antar halaman.

export interface WorkLogRow {
  stage?: string | null;
  employee_name?: string | null;
  created_at?: string | null;
}

export interface StageTimelineEntry {
  key: string;
  label: string;
  icon: string;
  crew: string | null;
  at: string | null;
  done: boolean;
}

/**
 * Memetakan nama tahap bebas (dari kolom work_logs.stage atau transactions.status)
 * ke kunci baku.
 *
 * Catatan bahasa yang penting: awalan "meng-" melebur dengan huruf k pada akar
 * katanya, sehingga 'Mengeringkan' TIDAK mengandung substring 'kering' dan
 * 'Mengemas' TIDAK mengandung 'kemas'. Karena itu pencocokan memakai akar
 * 'ering' dan 'emas'.
 */
export const stageKeyOf = (stageStr: any): string => {
  const s = String(stageStr || '').toLowerCase().trim();
  if (s.includes('sortir')) return 'sortir';
  if (s.includes('cuci') || s.includes('mencuci')) return 'cuci';
  if (s.includes('ering')) return 'kering';
  if (s.includes('setrika') || s.includes('gosok')) return 'setrika';
  if (s.includes('pack') || s.includes('emas')) return 'packing';
  // Dicek sebelum 'diambil': 'Siap Diambil' mengandung kata 'diambil' padahal
  // cucian belum diserahkan ke pelanggan.
  if (s.includes('siap')) return 'siap';
  if (s.includes('mengantar') || s.includes('diantar') || s.includes('delivery')) return 'siap';
  if (s.includes('selesai jemput')) return 'outlet';
  if (
    s.includes('baru') ||
    s.includes('menunggu') ||
    s.includes('request') ||
    s.includes('menuju') ||
    s.includes('jemput') ||
    s.includes('dibawa')
  ) {
    return 'jemput';
  }
  if (s.includes('tiba') || s.includes('diterima') || s.includes('kasir')) return 'outlet';
  if (s.includes('selesai') || s.includes('diambil') || s.includes('delivered') || s.includes('terkirim')) {
    return 'selesai';
  }
  return s;
};

// Tahap yang punya tarif komisi di pengaturan layanan (Owner).
export const PAID_STAGE_KEYS = ['sortir', 'cuci', 'kering', 'setrika', 'packing'];

export const STAGE_SEQUENCE: { key: string; label: string; icon: string }[] = [
  { key: 'sortir', label: 'Sortir', icon: '🔍' },
  { key: 'cuci', label: 'Cuci', icon: '🧼' },
  { key: 'kering', label: 'Kering', icon: '🌀' },
  { key: 'setrika', label: 'Setrika', icon: '👔' },
  { key: 'packing', label: 'Packing', icon: '🎁' },
  { key: 'siap', label: 'Siap Diantar', icon: '🚚' },
  { key: 'selesai', label: 'Selesai', icon: '✅' }
];

/** Timeline pelanggan: jemput → outlet/kasir → pengerjaan → siap → selesai. */
export const CUSTOMER_STAGE_SEQUENCE: { key: string; label: string; icon: string }[] = [
  { key: 'jemput', label: 'Penjemputan Driver', icon: '🛺' },
  { key: 'outlet', label: 'Sampai Outlet / Diterima Kasir', icon: '🏠' },
  { key: 'sortir', label: 'Sortir', icon: '🔍' },
  { key: 'cuci', label: 'Cuci', icon: '🧼' },
  { key: 'kering', label: 'Kering', icon: '🌀' },
  { key: 'setrika', label: 'Setrika', icon: '👔' },
  { key: 'packing', label: 'Packing', icon: '🎁' },
  { key: 'siap', label: 'Siap Diambil / Diantar', icon: '📦' },
  { key: 'selesai', label: 'Selesai', icon: '✅' }
];

/** Contoh keluaran: "28 Agu 2026, 14:32". String kosong bila tanggal tidak valid. */
export const formatStageTime = (iso: any): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';

  const tanggal = d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const jam = String(d.getHours()).padStart(2, '0');
  const menit = String(d.getMinutes()).padStart(2, '0');
  return `${tanggal}, ${jam}:${menit}`;
};

/**
 * Menyusun timeline tahap dari work_logs. Kolom `by_*` pada transactions dipakai
 * sebagai sumber nama crew cadangan (hanya `by_sortir` yang ada di schema).
 *
 * Aman terhadap data kosong: bila work_logs tidak tersedia, setiap tahap tetap
 * dikembalikan dengan done=false agar UI dapat merender kerangka timeline.
 */
export const isPickupOrigin = (order: any) =>
  Boolean(order?.pickup_id || order?.order_number || order?.photo_url || order?.photo_outlet_url);

export const buildStageTimeline = (
  logs: WorkLogRow[] | null | undefined,
  transaction?: any,
  opts?: { variant?: 'ops' | 'customer' }
): StageTimelineEntry[] => {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const currentStageKey = stageKeyOf(transaction?.status);
  const sequence =
    opts?.variant === 'customer'
      ? isPickupOrigin(transaction)
        ? CUSTOMER_STAGE_SEQUENCE
        : CUSTOMER_STAGE_SEQUENCE.filter((s) => s.key !== 'jemput')
      : STAGE_SEQUENCE;
  const statusIndex = sequence.findIndex((s) => s.key === currentStageKey);

  return sequence.map((stage, idx) => {
    // Log terakhir untuk tahap ini dianggap paling sahih (bila ada pengulangan).
    const matches = safeLogs.filter((l) => stageKeyOf(l?.stage) === stage.key);
    const last = matches.length > 0 ? matches[matches.length - 1] : null;

    const fallbackCrew = transaction?.[`by_${stage.key}`] || null;
    const passedByStatus = statusIndex > idx && statusIndex !== -1;
    const isOutletNow = stage.key === 'outlet' && currentStageKey === 'outlet';
    const isJemputNow = stage.key === 'jemput' && currentStageKey === 'jemput';
    const isFinalDone =
      stage.key === 'selesai' && ['selesai', 'diambil'].includes(currentStageKey);
    const isSiapNow = stage.key === 'siap' && currentStageKey === 'siap';
    const done = Boolean(last) || passedByStatus || isFinalDone || isSiapNow || isOutletNow;

    let at = last?.created_at || null;
    if (!at && stage.key === 'outlet' && done && transaction?.created_at && currentStageKey !== 'jemput') {
      at = transaction.created_at;
    }
    if (!at && stage.key === 'jemput' && (done || isJemputNow)) {
      at = transaction.pickup_created_at || (!transaction?.receipt_number ? transaction.created_at : null);
    }

    return {
      key: stage.key,
      label: stage.label,
      icon: stage.icon,
      crew: last?.employee_name || fallbackCrew,
      at,
      done
    };
  });
};
