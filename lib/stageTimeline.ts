// Sumber tunggal untuk pemetaan tahap pengerjaan + timeline waktu & crew.
// Dipakai bersama oleh POS, Owner, halaman Track publik, dan dashboard customer
// supaya tidak ada lagi logika pencocokan tahap yang berbeda antar halaman.

export interface WorkLogRow {
  stage?: string | null;
  employee_name?: string | null;
  created_at?: string | null;
  notes?: string | null;
  photo_url?: string | null;
}

export interface StageTimelineEntry {
  key: string;
  label: string;
  icon: string;
  crew: string | null;
  at: string | null;
  done: boolean;
  notes: string | null;
  photoUrl: string | null;
  /** Semua bukti foto tahap (multi-item Sortir/Dikemas). photoUrl = foto pertama. */
  photoUrls: string[];
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
export const isOrderPaid = (order: any) => {
  if (order?.is_paid === true) return true;
  const pay = String(order?.payment_status || '').toLowerCase();
  if (['paid', 'lunas', 'verified'].includes(pay)) return true;
  const st = String(order?.status || '').toLowerCase().trim();
  return st === 'paid' || st.includes('lunas') || st.includes('sudah dibayar');
};

export const isAwaitingPayment = (order: any) => {
  if (isOrderPaid(order)) return false;
  const st = String(order?.status || '').toLowerCase();
  const pay = String(order?.payment_status || '').toLowerCase();
  return (
    st.includes('menunggu_pembayaran') ||
    st.includes('menunggu pembayaran') ||
    pay === 'pending' ||
    pay === 'menunggu'
  );
};

export const stageKeyOf = (stageStr: any): string => {
  const s = String(stageStr || '').toLowerCase().trim();
  if (s.includes('menunggu_pembayaran') || s.includes('menunggu pembayaran') || s === 'paid' || s === 'lunas') {
    return 'pembayaran';
  }
  if (s.includes('sortir')) return 'sortir';
  if (s.includes('cuci') || s.includes('mencuci')) return 'cuci';
  if (s.includes('ering')) return 'kering';
  if (s.includes('setrika') || s.includes('gosok')) return 'setrika';
  if (s.includes('pack') || s.includes('emas')) return 'packing';
  // Dicek sebelum 'diambil': 'Siap Diambil' mengandung kata 'diambil' padahal
  // cucian belum diserahkan ke pelanggan.
  if (s.includes('rak') || s.includes('penyimpanan')) return 'siap';
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
  { key: 'packing', label: 'Dikemas', icon: '🎁' },
  { key: 'siap', label: 'Siap Diantar', icon: '🚚' },
  { key: 'selesai', label: 'Selesai', icon: '✅' }
];

/** Timeline pelanggan: jemput → outlet/kasir → pembayaran → pengerjaan → siap → selesai. */
export const CUSTOMER_STAGE_SEQUENCE: { key: string; label: string; icon: string }[] = [
  { key: 'jemput', label: 'Penjemputan Driver', icon: '🛺' },
  { key: 'outlet', label: 'Sampai Outlet / Diterima Kasir', icon: '🏠' },
  { key: 'pembayaran', label: 'Pembayaran', icon: '💳' },
  { key: 'sortir', label: 'Sortir', icon: '🔍' },
  { key: 'cuci', label: 'Cuci', icon: '🧼' },
  { key: 'kering', label: 'Kering', icon: '🌀' },
  { key: 'setrika', label: 'Setrika', icon: '👔' },
  { key: 'packing', label: 'Dikemas', icon: '🎁' },
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

/** Label tampilan: status DB `Packing` ditampilkan sebagai Dikemas. */
export const displayStatusLabel = (status: any, order?: any): string => {
  const raw = String(status || order?.status || '').trim();
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (s === 'paid' || s === 'lunas' || s.includes('sudah dibayar')) return 'Sudah Dibayar';
  if (s.includes('menunggu_pembayaran') || s.includes('menunggu pembayaran')) return 'Menunggu Pembayaran';
  if (order && isOrderPaid(order) && stageKeyOf(raw) === 'pembayaran') return 'Sudah Dibayar';
  if (stageKeyOf(raw) === 'packing') return 'Dikemas';
  if (stageKeyOf(raw) === 'outlet') return 'Diterima Kasir';
  return raw;
};

const uniqPhotoUrls = (urls: Array<string | null | undefined>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const s = String(raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const itemsOf = (transaction: any): any[] => {
  const raw = transaction?.items;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const itemPhotosForStage = (transaction: any, stageKey: string): string[] => {
  return itemsOf(transaction).flatMap((it) => {
    if (stageKey === 'sortir') {
      return [it?.sortir_photo_url, it?.photo_url].filter(Boolean);
    }
    if (stageKey === 'packing') {
      return [it?.packing_photo_url, it?.dikemas_photo_url].filter(Boolean);
    }
    return [];
  });
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
    // Semua log tahap ini dipertahankan agar foto multi-item Sortir/Dikemas tidak hilang.
    const matches = safeLogs.filter((l) => stageKeyOf(l?.stage) === stage.key);
    const last = matches.length > 0 ? matches[matches.length - 1] : null;

    const fallbackCrew = transaction?.[`by_${stage.key}`] || null;
    const passedByStatus = statusIndex > idx && statusIndex !== -1;
    const isOutletNow = stage.key === 'outlet' && currentStageKey === 'outlet';
    const isJemputNow = stage.key === 'jemput' && currentStageKey === 'jemput';
    const paid = isOrderPaid(transaction);
    const isFinalDone =
      stage.key === 'selesai' && ['selesai', 'diambil'].includes(currentStageKey);
    const isSiapNow = stage.key === 'siap' && currentStageKey === 'siap';
    const done =
      stage.key === 'pembayaran'
        ? Boolean(last) || paid || passedByStatus
        : Boolean(last) || passedByStatus || isFinalDone || isSiapNow || isOutletNow;

    let at = last?.created_at || null;
    if (!at && stage.key === 'outlet' && done && transaction?.created_at && currentStageKey !== 'jemput') {
      at = transaction.created_at;
    }
    if (!at && stage.key === 'jemput' && (done || isJemputNow)) {
      at = transaction.pickup_created_at || (!transaction?.receipt_number ? transaction.created_at : null);
    }
    if (!at && stage.key === 'pembayaran' && done) {
      at = transaction?.paid_at || last?.created_at || null;
    }

    const rackPhoto = stage.key === 'siap' ? transaction?.rack_photo_url || null : null;
    const photoUrls = uniqPhotoUrls([
      ...matches.map((l) => l?.photo_url),
      ...(stage.key === 'sortir' ? [transaction?.sortir_photo_url] : []),
      ...itemPhotosForStage(transaction, stage.key),
      rackPhoto
    ]);

    return {
      key: stage.key,
      label: stage.label,
      icon: stage.icon,
      crew: last?.employee_name || fallbackCrew,
      at,
      done,
      notes:
        last?.notes ||
        (stage.key === 'siap' ? transaction?.rack_notes || null : null) ||
        (stage.key === 'pembayaran' && done ? 'Sudah Dibayar' : null),
      photoUrl: photoUrls[0] || null,
      photoUrls
    };
  });
};
