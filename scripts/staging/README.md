# Prosedur uji staging PR #5

Terpisah dari `scripts/e2e/local-supabase` (runner localhost dan pengamannya
tidak berubah). Semua skrip di sini hanya mau berjalan terhadap proyek
staging dan menolak produksi sebelum membuka koneksi. Tidak ada kunci atau
password yang dicetak.

## 0. Prasyarat

- Jaringan mengizinkan `<STAGING_REF>.supabase.co` (dan host DB/pooler staging).
- Environment variable (bukan di chat, bukan di git):
  `STAGING_REF`, `STAGING_SUPABASE_URL` (= `https://<STAGING_REF>.supabase.co`),
  `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`,
  `STAGING_DB_URL` (host `db.<STAGING_REF>.supabase.co` atau pooler dengan user `postgres.<STAGING_REF>`).
- `psql`, Node, Chromium (`CHROMIUM_PATH`), `npm i --no-save playwright-core`.

## 1. Buktikan target Preview

Buka `https://<preview>/api/health/db-target?verify=1`. Lanjut hanya bila:
`safeForTesting: true`, `browser.projectRef` = `server.projectRef` = `STAGING_REF`,
`verify.anonKey.accepted` dan `verify.serviceKey.accepted` = `true`.
(`serviceRole.projectRef: null` normal untuk kunci `sb_secret_…`; bukti
kepemilikannya adalah `verify.serviceKey.accepted`.)

## 2. Dump SKEMA produksi (dilakukan pemegang kredensial produksi)

Repo tidak memuat tabel inti (`pickup_orders`, `outlets`, `employees`, …);
sumber skema yang benar adalah skema produksi. Hanya katalog yang dibaca —
tanpa data:

```bash
npx supabase@2 db dump --db-url "$PROD_DB_URL" --schema public -f ~/prod-schema.dump.sql
```

Jangan pakai `--data-only` / `--use-copy`. Simpan di luar repo
(`*.dump.sql` diabaikan git). `prepare.ts` menolak file yang berisi data.

## 3. Siapkan staging

```bash
npm run staging:prepare -- --schema-dump ~/prod-schema.dump.sql --dry-run   # cek saja
npm run staging:prepare -- --schema-dump ~/prod-schema.dump.sql
```

Langkah yang dicetak: guard → staging menerima kedua kunci → koneksi DB →
marker `lm_staging` → validasi dump (tanpa data; HTTP keluar/ref produksi di
trigger/fungsi harus ditinjau lalu `--outbound-http-reviewed`) → dump
diterapkan (satu transaksi) → migrasi PR #5
(`20260923_customer_verified_login.sql`, `20260924_satuan_item_photos.sql`),
masing-masing sekali → seed sintetis (`seed.sql`) → verifikasi via API
(termasuk `pickup_date NOT NULL`). Database yang sudah berisi tabel tanpa
marker ditolak kecuali `--adopt-existing` (hanya bila yakin itu staging).

## 4. Uji end-to-end terhadap staging

```bash
NEXT_PUBLIC_SUPABASE_URL=$STAGING_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$STAGING_SUPABASE_ANON_KEY npm run build
npm run staging:e2e
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
npm run staging:cleanup               # hitung saja
npm run staging:cleanup -- --execute  # hapus data uji (+ --all untuk seed)
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
