# Prosedur uji staging PR #5

Terpisah dari `scripts/e2e/local-supabase` (runner localhost dan pengamannya
tidak berubah). Semua skrip di sini hanya mau berjalan terhadap proyek
staging dan menolak produksi sebelum membuka koneksi. Tidak ada kunci atau
password yang dicetak.

Langkah lengkap untuk Mac (dump read-only, peninjauan, Session pooler):
**[PANDUAN_MAC.md](PANDUAN_MAC.md)**.

## 0. Prasyarat

- Postgres (5432) harus terjangkau: jalankan langkah DB dari Mac/CI, bukan
  dari sesi cloud yang proxy-nya tidak meneruskan TCP database.
- Rahasia (service key, password DB) diminta tersembunyi oleh
  `scripts/staging/run-staging.sh` / `dump-prod-schema.sh`; jangan dipasang di
  pengaturan environment yang bisa dilihat orang lain.
- Non-rahasia: `STAGING_REF`, `STAGING_SUPABASE_URL`, `STAGING_DB_HOST`
  (host Session pooler). Koneksi DB dibentuk dari host + password dengan user
  `postgres.<STAGING_REF>` dan port 5432 (atau `STAGING_DB_URL`).
- Sesi cloud dengan `STAGING_REF`, `STAGING_SUPABASE_URL`,
  `STAGING_SUPABASE_ANON_KEY` saja dapat menjalankan
  `npx tsx scripts/staging/check-connection.ts --anon-only` (baca saja).

## 1. Buktikan target Preview

Buka `https://<preview>/api/health/db-target?verify=1`. Lanjut hanya bila:
`safeForTesting: true`, `browser.projectRef` = `server.projectRef` = `STAGING_REF`,
`verify.anonKey.accepted` dan `verify.serviceKey.accepted` = `true`.

## 2. Dump SKEMA produksi (read-only)

`scripts/staging/dump-prod-schema.sh <host-session-pooler-produksi> ~/lm-staging/prod-schema.dump.sql`
— sesi dipaksa read-only, `pg_dump --schema-only --schema=public`, file di luar
repo (mode 600, `*.dump.sql` diabaikan git). Periksa dengan
`npx tsx scripts/staging/check-dump.ts <file>`; `prepare.ts` menolak file berisi data.

## 3. Siapkan staging

```bash
scripts/staging/run-staging.sh prepare --schema-dump ~/lm-staging/prod-schema.clean.dump.sql --dry-run --dump-reviewed   # cek saja
scripts/staging/run-staging.sh prepare --schema-dump ~/lm-staging/prod-schema.clean.dump.sql --dump-reviewed
```

Langkah yang dicetak: guard → staging menerima kedua kunci → koneksi DB →
marker `lm_staging` → validasi dump (tanpa data; HTTP keluar/ref produksi di
trigger/fungsi dan literal mirip rahasia harus ditinjau lalu `--dump-reviewed`) → dump
diterapkan (satu transaksi) → migrasi PR #5
(`20260923_customer_verified_login.sql`, `20260924_satuan_item_photos.sql`),
masing-masing sekali → seed sintetis (`seed.sql`) → verifikasi via API
(termasuk `pickup_date NOT NULL`). Database yang sudah berisi tabel tanpa
marker ditolak kecuali `--adopt-existing` (hanya bila yakin itu staging).

## 4. Uji end-to-end terhadap staging

```bash
scripts/staging/run-staging.sh e2e   # build terhadap staging lalu uji (secret diminta tersembunyi)
```

Runner menjalankan app lokal yang terhubung ke staging (fitur foto hanya
dinyalakan untuk proses ini) dan berhenti sebelum tes apa pun bila
`/api/health/db-target?verify=1` tidak membuktikan staging. Cakupan: penguncian
bucket foto, signed upload URL, pesanan segera (2 kantong dipisah + foto satuan,
triple tap → 1 pesanan, 1 tugas driver + 1 tugas CS), pesanan terjadwal,
otorisasi staf (kasir outlet/lain, driver, CS, cookie palsu, perubahan peran),
audit log, tampilan POS/CS/driver, report-error tanpa data pribadi, dan
tidak ada request ke host produksi. Password staf sintetis acak per run.

## 5. Bersihkan

```bash
STAGING_DB_HOST=<host> scripts/staging/run-staging.sh cleanup               # hitung saja
STAGING_DB_HOST=<host> scripts/staging/run-staging.sh cleanup --execute     # hapus data uji (+ --all untuk seed)
```

Hanya baris sintetis (`0800000000xx`, staf `stg_*`, `[STAGING]`) dan foto di
bucket `satuan-item-photos` staging.

## Batasan

- `db dump --schema public` tidak menyertakan bucket/policy Storage lain
  (mis. `outlet-photos`); fitur yang membutuhkannya perlu migrasi bucket terkait.
- Runner menguji build lokal terhadap database staging; deployment Preview
  sendiri dibuktikan lewat langkah 1.
- `--selftest-local` pada ketiga skrip hanya untuk menguji skrip terhadap
  stack Supabase lokal — bukan hasil staging.
