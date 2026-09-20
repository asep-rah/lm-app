/**
 * Rekap pemakaian vendor untuk penagihan (Admin Operasional).
 *
 * Vendor yang menagih per periode: Lalamove (kurir pihak ketiga), mCoin
 * Smartlink, dan vendor lain yang menyusul. Agregasi dan aturan periode hidup
 * di sini supaya angka di halaman rekap, ekspor CSV, dan impor n8n memakai
 * definisi yang sama.
 *
 * Tabel ini murni pencatatan pemakaian untuk ditagihkan. TIDAK menulis ke
 * expenses dan tidak menyentuh domain finance.
 */

import { supabase } from '@/lib/supabaseClient';
import { insertWithFallback } from '@/lib/safeWrite';

export const VENDOR_SOURCE = {
  /** Diketik Admin Ops untuk vendor yang belum terintegrasi. */
  MANUAL: 'manual',
  /** Diimpor otomatis lewat /api/integrations/n8n/vendor-usage. */
  N8N: 'n8n',
  /** Disalin dari data yang sudah ada di sistem, mis. third_party_deliveries. */
  INTERNAL: 'internal'
} as const;

export type VendorAccount = {
  id: string;
  vendor_key: string;
  label: string | null;
  billing_cycle: string | null;
  notes: string | null;
  is_active: boolean | null;
};

export type VendorUsageEntry = {
  id: string;
  vendor_key: string;
  outlet_id: string | null;
  usage_date: string;
  reference: string | null;
  amount: number | null;
  qty: number | null;
  source: string | null;
  external_id: string | null;
  meta: Record<string, unknown> | null;
  billing_period: string | null;
  billed_at: string | null;
  billed_by: string | null;
  created_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Periode
// ---------------------------------------------------------------------------

/**
 * Periode penagihan 'YYYY-MM' dari sebuah tanggal.
 *
 * Tanggal 'YYYY-MM-DD' dipotong apa adanya, tidak lewat Date, supaya pemakaian
 * tanggal 1 pukul 00:00 tidak pindah ke bulan sebelumnya karena zona waktu.
 */
export const billingPeriodOf = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  if (typeof date === 'string') {
    const m = date.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = date instanceof Date ? date : new Date(String(date));
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Batas tanggal sebuah periode, inklusif di kedua ujung. */
export const periodBounds = (period: string): { start: string; end: string } | null => {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
};

export const currentPeriod = (now = new Date()) => billingPeriodOf(now);

/** Periode terakhir sampai `count` bulan ke belakang, terbaru lebih dulu. */
export const recentPeriods = (count = 6, now = new Date()): string[] => {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

/** Periode sebuah entri: kolom billing_period bila ada, kalau tidak dari tanggal pemakaian. */
export const entryPeriod = (entry: Partial<VendorUsageEntry>) =>
  String(entry?.billing_period || '') || billingPeriodOf(entry?.usage_date);

export const isEntryBilled = (entry: Partial<VendorUsageEntry>) => Boolean(entry?.billed_at);

// ---------------------------------------------------------------------------
// Agregasi
// ---------------------------------------------------------------------------

export type VendorTotals = {
  vendorKey: string;
  entries: number;
  qty: number;
  amount: number;
  unbilledEntries: number;
  unbilledAmount: number;
  outletCount: number;
  /** Entri yang nominalnya belum diisi -- tarif baru diketahui dari tagihan vendor. */
  missingAmount: number;
};

const emptyTotals = (vendorKey: string): VendorTotals => ({
  vendorKey,
  entries: 0,
  qty: 0,
  amount: 0,
  unbilledEntries: 0,
  unbilledAmount: 0,
  outletCount: 0,
  missingAmount: 0
});

/**
 * Rekap per vendor. Nominal nol dihitung sebagai "belum ada tarif", bukan gratis:
 * third_party_deliveries tidak menyimpan biaya kurir, jadi entri hasil
 * sinkronisasi memang masuk tanpa nominal sampai tagihan vendor tiba.
 */
export const totalsByVendor = (entries: VendorUsageEntry[]): VendorTotals[] => {
  const map = new Map<string, VendorTotals>();
  const outlets = new Map<string, Set<string>>();

  (entries || []).forEach((e) => {
    const key = String(e?.vendor_key || '').trim();
    if (!key) return;
    const t = map.get(key) || emptyTotals(key);
    const amount = Number(e?.amount) || 0;
    t.entries += 1;
    t.qty += Number(e?.qty) || 0;
    t.amount += amount;
    if (!amount) t.missingAmount += 1;
    if (!isEntryBilled(e)) {
      t.unbilledEntries += 1;
      t.unbilledAmount += amount;
    }
    map.set(key, t);

    if (e?.outlet_id) {
      const set = outlets.get(key) || new Set<string>();
      set.add(String(e.outlet_id));
      outlets.set(key, set);
    }
  });

  map.forEach((t, key) => {
    t.outletCount = outlets.get(key)?.size || 0;
  });

  return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.entries - a.entries);
};

export type OutletTotals = {
  outletId: string;
  entries: number;
  qty: number;
  amount: number;
};

/** Rekap per outlet, untuk membagi tagihan vendor ke outlet yang memakainya. */
export const totalsByOutlet = (entries: VendorUsageEntry[]): OutletTotals[] => {
  const map = new Map<string, OutletTotals>();
  (entries || []).forEach((e) => {
    const id = String(e?.outlet_id || '') || '(tanpa outlet)';
    const t = map.get(id) || { outletId: id, entries: 0, qty: 0, amount: 0 };
    t.entries += 1;
    t.qty += Number(e?.qty) || 0;
    t.amount += Number(e?.amount) || 0;
    map.set(id, t);
  });
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.entries - a.entries);
};

export const grandTotal = (entries: VendorUsageEntry[]) =>
  (entries || []).reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);

export const unbilledEntries = (entries: VendorUsageEntry[]) =>
  (entries || []).filter((e) => !isEntryBilled(e));

// ---------------------------------------------------------------------------
// Impor (dipakai halaman rekap dan endpoint n8n)
// ---------------------------------------------------------------------------

export type UsageImportInput = {
  vendor_key?: string;
  outlet_id?: string | null;
  usage_date?: string;
  reference?: string | null;
  amount?: number | string | null;
  qty?: number | string | null;
  external_id?: string | null;
  meta?: Record<string, unknown> | null;
  billing_period?: string | null;
};

/**
 * Baris siap-insert dari payload luar. Mengembalikan pesan kesalahan bila
 * payload tidak layak -- lebih baik satu baris ditolak dengan alasan jelas
 * daripada tagihan tercatat dengan vendor atau tanggal kosong.
 */
export const normalizeUsageImport = (
  input: UsageImportInput,
  source: string = VENDOR_SOURCE.N8N
): { row: Record<string, unknown>; error: null } | { row: null; error: string } => {
  const vendorKey = String(input?.vendor_key || '').trim().toLowerCase();
  if (!vendorKey) return { row: null, error: 'vendor_key wajib diisi' };

  const usageDate = String(input?.usage_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(usageDate)) {
    return { row: null, error: `usage_date harus YYYY-MM-DD, dapat: ${usageDate || '(kosong)'}` };
  }

  const amount = Number(input?.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    return { row: null, error: `amount tidak valid: ${String(input?.amount)}` };
  }
  const qtyRaw = input?.qty ?? 1;
  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { row: null, error: `qty tidak valid: ${String(qtyRaw)}` };
  }

  const externalId = String(input?.external_id || '').trim();
  return {
    error: null,
    row: {
      vendor_key: vendorKey,
      outlet_id: input?.outlet_id || null,
      usage_date: usageDate.slice(0, 10),
      reference: input?.reference || null,
      amount,
      qty,
      source,
      external_id: externalId || null,
      meta: input?.meta || {},
      billing_period: input?.billing_period || billingPeriodOf(usageDate)
    }
  };
};

/** Buang baris dengan external_id kembar di dalam satu payload. */
export const dedupeByExternalId = (rows: Record<string, unknown>[]) => {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  rows.forEach((row) => {
    const ext = String(row?.external_id || '').trim();
    if (!ext) {
      out.push(row);
      return;
    }
    const key = `${String(row.vendor_key)}::${ext}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
};

/** Klien Supabase minimal yang dibutuhkan importUsageEntries. */
type UpsertClient = {
  from: (table: string) => {
    upsert: (
      rows: Record<string, unknown>[],
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  };
};

/**
 * Impor idempoten. Klien di-inject supaya endpoint n8n bisa memakai service
 * role sementara pengujian memakai klien tiruan.
 *
 * Idempotensi bersandar pada indeks unik (vendor_key, external_id): kiriman
 * yang sama dua kali tidak menambah baris. Entri tanpa external_id tidak
 * terlindungi -- itu hanya untuk input manual, bukan impor otomatis.
 */
export const importUsageEntries = async (
  db: UpsertClient,
  inputs: UsageImportInput[],
  source: string = VENDOR_SOURCE.N8N
): Promise<{ inserted: number; skipped: number; rejected: { index: number; error: string }[]; error: string | null }> => {
  const rejected: { index: number; error: string }[] = [];
  const rows: Record<string, unknown>[] = [];

  (inputs || []).forEach((input, index) => {
    const res = normalizeUsageImport(input, source);
    // Dicabang lewat res.row, bukan res.error: string kosong juga falsy, jadi
    // pengecekan error tidak mempersempit tipe union-nya.
    if (res.row) rows.push(res.row);
    else rejected.push({ index, error: res.error });
  });

  const unique = dedupeByExternalId(rows);
  const withoutExternalId = unique.filter((r) => !r.external_id).length;
  if (withoutExternalId) {
    rejected.push({
      index: -1,
      error: `${withoutExternalId} baris tanpa external_id ditolak: impor otomatis wajib punya kunci idempotensi`
    });
  }
  const insertable = unique.filter((r) => Boolean(r.external_id));

  if (!insertable.length) {
    return { inserted: 0, skipped: 0, rejected, error: null };
  }

  const { data, error } = await db
    .from('vendor_usage_entries')
    .upsert(insertable, { onConflict: 'vendor_key,external_id', ignoreDuplicates: true });

  if (error) return { inserted: 0, skipped: 0, rejected, error: error.message };

  const inserted = Array.isArray(data) ? data.length : insertable.length;
  return { inserted, skipped: insertable.length - inserted, rejected, error: null };
};

// ---------------------------------------------------------------------------
// Ekspor CSV
// ---------------------------------------------------------------------------

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Isi CSV sebagai teks -- dipisah dari unduhannya supaya bisa diuji. */
export const vendorRecapCsvText = (
  entries: VendorUsageEntry[],
  outletNames: Record<string, string> = {}
): string => {
  const header = [
    'Tanggal',
    'Vendor',
    'Outlet',
    'Referensi',
    'Qty',
    'Nominal (Rp)',
    'Periode',
    'Sumber',
    'Status Tagih'
  ];
  const lines = [header.join(',')];
  (entries || []).forEach((e) => {
    lines.push(
      [
        e.usage_date || '',
        e.vendor_key || '',
        outletNames[String(e.outlet_id || '')] || '',
        e.reference || '',
        Number(e.qty) || 0,
        Number(e.amount) || 0,
        entryPeriod(e),
        e.source || '',
        isEntryBilled(e) ? 'Sudah ditagih' : 'Belum ditagih'
      ]
        .map(csvCell)
        .join(',')
    );
  });
  return lines.join('\n');
};

export const downloadVendorRecapCsv = (
  entries: VendorUsageEntry[],
  outletNames: Record<string, string> = {},
  filename = 'rekap_vendor'
) => {
  const blob = new Blob(['﻿' + vendorRecapCsvText(entries, outletNames)], {
    type: 'text/csv;charset=utf-8;'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Akses data (halaman rekap)
// ---------------------------------------------------------------------------

export const loadVendorAccounts = async (): Promise<VendorAccount[]> => {
  const { data, error } = await supabase
    .from('vendor_accounts')
    .select('*')
    .order('label', { ascending: true });
  if (error) {
    console.warn('vendor_accounts:', error.message);
    return [];
  }
  return (data as VendorAccount[]) || [];
};

/**
 * Entri pemakaian satu periode. Selalu dibatasi periode -- 115 outlet dikali
 * pemakaian harian tumbuh cepat, dan docs/PRD.md §8 melarang kueri all-time.
 */
export const loadUsageEntries = async (opts: {
  period: string;
  vendorKey?: string;
  outletIds?: string[];
  limit?: number;
}): Promise<VendorUsageEntry[]> => {
  const bounds = periodBounds(opts.period);
  if (!bounds) return [];

  let q = supabase
    .from('vendor_usage_entries')
    .select('*')
    .gte('usage_date', bounds.start)
    .lte('usage_date', bounds.end)
    .order('usage_date', { ascending: false })
    .limit(opts.limit ?? 500);

  if (opts.vendorKey) q = q.eq('vendor_key', opts.vendorKey);
  if (opts.outletIds?.length) q = q.in('outlet_id', opts.outletIds);

  const { data, error } = await q;
  if (error) {
    console.warn('vendor_usage_entries:', error.message);
    return [];
  }
  return (data as VendorUsageEntry[]) || [];
};

export const addManualUsage = async (opts: {
  vendorKey: string;
  outletId?: string | null;
  usageDate: string;
  reference?: string;
  amount: number;
  qty?: number;
  actorName?: string;
}) => {
  const res = normalizeUsageImport(
    {
      vendor_key: opts.vendorKey,
      outlet_id: opts.outletId || null,
      usage_date: opts.usageDate,
      reference: opts.reference || null,
      amount: opts.amount,
      qty: opts.qty ?? 1
    },
    VENDOR_SOURCE.MANUAL
  );
  if (!res.row) return { error: { message: res.error } };

  const row = { ...res.row, created_by: opts.actorName || null };
  const { error } = await insertWithFallback('vendor_usage_entries', [
    row,
    { ...row, meta: undefined, created_by: undefined }
  ]);
  return { error };
};

/** Tandai entri sudah ditagihkan ke vendor. */
export const markEntriesBilled = async (ids: string[], actorName?: string) => {
  if (!ids.length) return { error: null };
  const { error } = await supabase
    .from('vendor_usage_entries')
    .update({ billed_at: new Date().toISOString(), billed_by: actorName || null })
    .in('id', ids);
  return { error: error ? { message: error.message } : null };
};

/**
 * Salin pengiriman Lalamove dari third_party_deliveries menjadi entri pemakaian.
 *
 * Bukan input ulang manual: external_id memakai id baris pengiriman, jadi
 * sinkronisasi boleh dijalankan berulang tanpa menggandakan tagihan.
 *
 * third_party_deliveries tidak menyimpan biaya kurir maupun outlet, sehingga
 * entri masuk dengan nominal 0 dan outlet kosong; keduanya dilengkapi Admin Ops
 * saat tagihan Lalamove tiba. Lebih baik pemakaiannya tercatat tanpa tarif
 * daripada tidak tercatat sama sekali.
 */
export const syncLalamoveUsage = async (opts: { period: string; actorName?: string }) => {
  const bounds = periodBounds(opts.period);
  if (!bounds) return { synced: 0, error: { message: 'Periode tidak valid' } };

  const { data, error } = await supabase
    .from('third_party_deliveries')
    .select('id, receipt_number, courier_vendor, created_at, transaction_id')
    .ilike('courier_vendor', 'lalamove')
    .gte('created_at', `${bounds.start}T00:00:00Z`)
    .lte('created_at', `${bounds.end}T23:59:59Z`)
    .limit(1000);

  if (error) return { synced: 0, error: { message: error.message } };

  type DeliveryRow = {
    id: string;
    receipt_number: string | null;
    created_at: string | null;
    transaction_id: string | null;
  };
  const deliveries = (data as DeliveryRow[]) || [];
  if (!deliveries.length) return { synced: 0, error: null };

  const inputs: UsageImportInput[] = deliveries.map((d) => ({
    vendor_key: 'lalamove',
    usage_date: String(d.created_at || '').slice(0, 10),
    reference: d.receipt_number || d.transaction_id || null,
    amount: 0,
    qty: 1,
    external_id: `tpd:${d.id}`,
    meta: { transaction_id: d.transaction_id || null, synced_by: opts.actorName || null }
  }));

  const res = await importUsageEntries(supabase as unknown as UpsertClient, inputs, VENDOR_SOURCE.INTERNAL);
  return { synced: res.inserted, error: res.error ? { message: res.error } : null };
};
