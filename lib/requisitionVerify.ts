/**
 * Deteksi dugaan pengajuan kembar untuk gerbang verifikasi Admin Ops.
 *
 * Hasilnya PENANDA PERINGATAN, bukan pemblokir: outlet memang kadang mengajukan
 * barang yang sama dua kali dalam sebulan secara sah. Admin Ops yang memutuskan
 * (docs/BUSINESS_RULES.md §18 butir 8).
 *
 * Fungsi di file ini murni -- tidak menyentuh jaringan -- supaya ambang batasnya
 * bisa diuji tanpa database.
 */

import { prAmount, prDescription, prRequestedBy, prTitle } from '@/lib/cmsRequisition';

/** Ambang batas deteksi. Satu tempat, supaya mudah disetel setelah dipakai nyata. */
export const DUPLICATE_RULES = {
  /** Rentang hari ke belakang yang diperiksa. */
  windowDays: 14,
  /** Selisih nominal yang masih dianggap "mirip", relatif terhadap nominal terbesar. */
  amountTolerance: 0.1,
  /** Proporsi kata judul/deskripsi yang harus bertumpang tindih. */
  textOverlapMin: 0.5,
  /** Skor minimal untuk ditampilkan sebagai dugaan. */
  flagAt: 0.5
} as const;

const STOPWORDS = new Set([
  'untuk', 'dan', 'atau', 'dengan', 'yang', 'dari', 'ke', 'di', 'pada',
  'outlet', 'pengajuan', 'beli', 'pembelian', 'restock', 'stok', 'buah', 'pcs'
]);

/** Kata bermakna dari sebuah teks: huruf saja, minimal 3 karakter, bukan stopword. */
export const textTokens = (text: string): Set<string> => {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return new Set(words);
};

/**
 * Tumpang tindih dua himpunan kata, relatif terhadap himpunan yang lebih KECIL.
 * "Deterjen 5L" vs "Deterjen 5L dan pewangi 2L untuk stok akhir bulan" harus
 * tetap terbaca mirip; memakai gabungan sebagai penyebut akan menenggelamkannya.
 */
export const tokenOverlap = (a: Set<string>, b: Set<string>): number => {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (!smaller.size) return 0;
  let hit = 0;
  smaller.forEach((t) => {
    if (larger.has(t)) hit += 1;
  });
  return hit / smaller.size;
};

export const amountsSimilar = (a: number, b: number, tolerance = DUPLICATE_RULES.amountTolerance) => {
  const big = Math.max(Math.abs(a), Math.abs(b));
  if (!big) return a === b;
  return Math.abs(a - b) / big <= tolerance;
};

export const daysApart = (aIso: any, bIso: any): number | null => {
  const a = new Date(String(aIso || '')).getTime();
  const b = new Date(String(bIso || '')).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.abs(a - b) / 86400000;
};

export type DuplicateSuspicion = {
  id: string;
  title: string;
  status: string;
  amount: number;
  createdAt: string | null;
  requestedBy: string;
  /** 0..1 — makin tinggi makin mirip. */
  score: number;
  /** Alasan berbahasa manusia, untuk ditampilkan apa adanya di UI. */
  reasons: string[];
};

const isDeadStatus = (row: any) => {
  const s = String(row?.status || '').toLowerCase();
  return s.includes('reject') || s.includes('revision') || s.includes('revisi');
};

/**
 * Pengajuan lain yang patut dicurigai kembaran dari `target`.
 *
 * Kandidat harus outlet yang sama dan masih hidup (bukan ditolak / dikembalikan),
 * lalu dinilai dari tiga sisi: kedekatan nominal, kategori, dan kemiripan teks.
 * Diurutkan dari yang paling mirip.
 */
export const findDuplicateSuspicions = (
  target: any,
  others: any[],
  rules = DUPLICATE_RULES
): DuplicateSuspicion[] => {
  if (!target) return [];
  const targetTokens = textTokens(`${prTitle(target)} ${prDescription(target)}`);
  const targetAmount = prAmount(target);
  const targetCategory = String(target?.category || '').trim().toLowerCase();

  const found: DuplicateSuspicion[] = [];

  (others || []).forEach((other) => {
    if (!other || String(other.id) === String(target.id)) return;
    if (String(other.outlet_id || '') !== String(target.outlet_id || '')) return;
    if (isDeadStatus(other)) return;

    const gap = daysApart(target.created_at, other.created_at);
    if (gap == null || gap > rules.windowDays) return;

    const reasons: string[] = [];
    let score = 0;

    if (amountsSimilar(targetAmount, prAmount(other), rules.amountTolerance)) {
      score += 0.4;
      reasons.push(`nominal mirip (${Math.round(prAmount(other)).toLocaleString('id-ID')})`);
    }

    const otherCategory = String(other?.category || '').trim().toLowerCase();
    if (targetCategory && targetCategory === otherCategory) {
      score += 0.2;
      reasons.push('kategori sama');
    }

    const overlap = tokenOverlap(targetTokens, textTokens(`${prTitle(other)} ${prDescription(other)}`));
    if (overlap >= rules.textOverlapMin) {
      score += 0.4 * overlap;
      reasons.push(`judul/deskripsi mirip ${Math.round(overlap * 100)}%`);
    }

    if (score < rules.flagAt) return;

    reasons.push(`selisih ${Math.round(gap)} hari`);
    found.push({
      id: String(other.id),
      title: prTitle(other),
      status: String(other.status || ''),
      amount: prAmount(other),
      createdAt: other.created_at || null,
      requestedBy: prRequestedBy(other),
      score: Math.min(1, Number(score.toFixed(2))),
      reasons
    });
  });

  return found.sort((a, b) => b.score - a.score);
};

/** Peta id pengajuan -> dugaan kembarannya, untuk seluruh daftar sekaligus. */
export const duplicateSuspicionMap = (rows: any[], rules = DUPLICATE_RULES) => {
  const map: Record<string, DuplicateSuspicion[]> = {};
  (rows || []).forEach((row) => {
    const hits = findDuplicateSuspicions(row, rows, rules);
    if (hits.length) map[String(row.id)] = hits;
  });
  return map;
};
