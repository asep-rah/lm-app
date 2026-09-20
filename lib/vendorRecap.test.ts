import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VENDOR_SOURCE,
  billingPeriodOf,
  dedupeByExternalId,
  entryPeriod,
  grandTotal,
  importUsageEntries,
  normalizeUsageImport,
  periodBounds,
  recentPeriods,
  totalsByOutlet,
  totalsByVendor,
  unbilledEntries,
  vendorRecapCsvText,
  type VendorUsageEntry
} from './vendorRecap';

const entry = (over: Partial<VendorUsageEntry>): VendorUsageEntry => ({
  id: Math.random().toString(36).slice(2),
  vendor_key: 'lalamove',
  outlet_id: 'o1',
  usage_date: '2026-09-05',
  reference: 'LM-1',
  amount: 25000,
  qty: 1,
  source: VENDOR_SOURCE.N8N,
  external_id: null,
  meta: {},
  billing_period: '2026-09',
  billed_at: null,
  billed_by: null,
  created_by: null,
  created_at: '2026-09-05T02:00:00Z',
  ...over
});

/** Klien tiruan: mencatat apa yang diupsert dan menirukan indeks unik. */
const fakeDb = () => {
  const stored = new Set<string>();
  const calls: { rows: Record<string, unknown>[]; opts: any }[] = [];
  return {
    stored,
    calls,
    from() {
      return {
        upsert: async (rows: Record<string, unknown>[], opts: any) => {
          calls.push({ rows, opts });
          const accepted: Record<string, unknown>[] = [];
          rows.forEach((r) => {
            const key = `${r.vendor_key}::${r.external_id}`;
            if (stored.has(key)) return; // ignoreDuplicates
            stored.add(key);
            accepted.push(r);
          });
          return { data: accepted, error: null };
        }
      };
    }
  };
};

describe('periode penagihan', () => {
  it('tanggal 1 tidak bergeser ke bulan sebelumnya', () => {
    // Lewat Date lokal, '2026-09-01' di zona UTC+7 bisa terbaca Agustus.
    assert.equal(billingPeriodOf('2026-09-01'), '2026-09');
    assert.equal(billingPeriodOf('2026-01-31'), '2026-01');
  });

  it('batas periode inklusif dan tahu bulan pendek', () => {
    assert.deepEqual(periodBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
    assert.deepEqual(periodBounds('2026-09'), { start: '2026-09-01', end: '2026-09-30' });
    assert.deepEqual(periodBounds('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  });

  it('periode tidak valid ditolak, bukan ditebak', () => {
    assert.equal(periodBounds('2026-13'), null);
    assert.equal(periodBounds('September'), null);
    assert.equal(billingPeriodOf(''), '');
  });

  it('daftar periode terbaru melewati batas tahun', () => {
    const periods = recentPeriods(3, new Date('2026-01-15T00:00:00Z'));
    assert.deepEqual(periods, ['2026-01', '2025-12', '2025-11']);
  });

  it('periode entri jatuh ke tanggal pemakaian bila kolomnya kosong', () => {
    assert.equal(entryPeriod(entry({ billing_period: null, usage_date: '2026-08-11' })), '2026-08');
  });
});

describe('agregasi rekap', () => {
  const entries = [
    entry({ vendor_key: 'lalamove', amount: 25000, outlet_id: 'o1' }),
    entry({ vendor_key: 'lalamove', amount: 30000, outlet_id: 'o2', billed_at: '2026-10-01T00:00:00Z' }),
    entry({ vendor_key: 'lalamove', amount: 0, outlet_id: 'o1' }),
    entry({ vendor_key: 'mcoin_smartlink', amount: 99000, qty: 3, outlet_id: 'o3' })
  ];

  it('menjumlahkan per vendor dan menghitung outlet unik', () => {
    const totals = totalsByVendor(entries);
    const lala = totals.find((t) => t.vendorKey === 'lalamove')!;
    assert.equal(lala.entries, 3);
    assert.equal(lala.amount, 55000);
    assert.equal(lala.outletCount, 2);
  });

  it('memisahkan yang belum ditagih', () => {
    const lala = totalsByVendor(entries).find((t) => t.vendorKey === 'lalamove')!;
    assert.equal(lala.unbilledEntries, 2);
    assert.equal(lala.unbilledAmount, 25000);
    assert.equal(unbilledEntries(entries).length, 3);
  });

  it('nominal nol dihitung sebagai tarif belum ada, bukan gratis', () => {
    const lala = totalsByVendor(entries).find((t) => t.vendorKey === 'lalamove')!;
    assert.equal(lala.missingAmount, 1);
  });

  it('rekap per outlet untuk membagi tagihan', () => {
    const byOutlet = totalsByOutlet(entries);
    assert.equal(byOutlet.find((o) => o.outletId === 'o1')!.amount, 25000);
    assert.equal(byOutlet.find((o) => o.outletId === 'o3')!.qty, 3);
  });

  it('entri tanpa outlet tidak hilang dari rekap', () => {
    const byOutlet = totalsByOutlet([entry({ outlet_id: null, amount: 12000 })]);
    assert.equal(byOutlet[0].outletId, '(tanpa outlet)');
    assert.equal(byOutlet[0].amount, 12000);
  });

  it('total keseluruhan', () => {
    assert.equal(grandTotal(entries), 154000);
    assert.equal(grandTotal([]), 0);
  });
});

describe('normalisasi impor', () => {
  it('menolak payload tanpa vendor atau tanggal salah format', () => {
    assert.match(String(normalizeUsageImport({ usage_date: '2026-09-01' }).error), /vendor_key/);
    assert.match(String(normalizeUsageImport({ vendor_key: 'lalamove', usage_date: '01-09-2026' }).error), /YYYY-MM-DD/);
  });

  it('menolak nominal dan qty tidak masuk akal', () => {
    const base = { vendor_key: 'lalamove', usage_date: '2026-09-01' };
    assert.match(String(normalizeUsageImport({ ...base, amount: -5 }).error), /amount/);
    assert.match(String(normalizeUsageImport({ ...base, qty: 0 }).error), /qty/);
  });

  it('mengisi periode dari tanggal dan menormalkan vendor_key', () => {
    const res = normalizeUsageImport({
      vendor_key: '  LalaMove ',
      usage_date: '2026-09-07T10:00:00Z',
      external_id: 'abc'
    });
    assert.equal(res.error, null);
    assert.equal(res.row!.vendor_key, 'lalamove');
    assert.equal(res.row!.usage_date, '2026-09-07');
    assert.equal(res.row!.billing_period, '2026-09');
  });

  it('external_id kembar dalam satu payload dibuang', () => {
    const rows = [
      { vendor_key: 'lalamove', external_id: 'x' },
      { vendor_key: 'lalamove', external_id: 'x' },
      { vendor_key: 'mcoin_smartlink', external_id: 'x' },
      { vendor_key: 'lalamove', external_id: null }
    ];
    assert.equal(dedupeByExternalId(rows).length, 3);
  });
});

describe('idempotensi impor', () => {
  const payload = [
    { vendor_key: 'lalamove', usage_date: '2026-09-01', amount: 25000, external_id: 'LM-A' },
    { vendor_key: 'lalamove', usage_date: '2026-09-02', amount: 30000, external_id: 'LM-B' }
  ];

  it('kiriman kedua tidak menambah baris', async () => {
    const db = fakeDb();
    const first = await importUsageEntries(db, payload);
    assert.equal(first.inserted, 2);
    assert.equal(first.error, null);

    const second = await importUsageEntries(db, payload);
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped, 2);
    assert.equal(db.stored.size, 2);
  });

  it('memakai on conflict, bukan insert biasa', async () => {
    const db = fakeDb();
    await importUsageEntries(db, payload);
    assert.equal(db.calls[0].opts.onConflict, 'vendor_key,external_id');
    assert.equal(db.calls[0].opts.ignoreDuplicates, true);
  });

  it('impor otomatis tanpa external_id ditolak, bukan disimpan', async () => {
    const db = fakeDb();
    const res = await importUsageEntries(db, [
      { vendor_key: 'lalamove', usage_date: '2026-09-01', amount: 1000 }
    ]);
    assert.equal(res.inserted, 0);
    assert.equal(db.stored.size, 0);
    assert.match(res.rejected.map((r) => r.error).join(' '), /external_id/);
  });

  it('baris buruk ditolak tanpa menggagalkan baris yang baik', async () => {
    const db = fakeDb();
    const res = await importUsageEntries(db, [
      { vendor_key: 'lalamove', usage_date: '2026-09-01', amount: 1000, external_id: 'ok-1' },
      { vendor_key: '', usage_date: '2026-09-01', external_id: 'bad-1' }
    ]);
    assert.equal(res.inserted, 1);
    assert.equal(res.rejected.length, 1);
    assert.equal(res.rejected[0].index, 1);
  });

  it('payload kosong tidak memanggil database', async () => {
    const db = fakeDb();
    const res = await importUsageEntries(db, []);
    assert.equal(res.inserted, 0);
    assert.equal(db.calls.length, 0);
  });
});

describe('ekspor CSV', () => {
  it('memakai nama outlet dan menandai status tagih', () => {
    const csv = vendorRecapCsvText(
      [entry({ outlet_id: 'o1', billed_at: null }), entry({ outlet_id: 'o1', billed_at: '2026-10-01' })],
      { o1: 'Outlet Sampangan' }
    );
    const lines = csv.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[1], /Outlet Sampangan/);
    assert.match(lines[1], /Belum ditagih/);
    assert.match(lines[2], /Sudah ditagih/);
  });

  it('tanda kutip di data tidak merusak kolom', () => {
    const csv = vendorRecapCsvText([entry({ reference: 'order "kilat"' })]);
    assert.match(csv, /"order ""kilat"""/);
  });
});
