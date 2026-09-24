# Panduan Mac: dump skema produksi → staging (PR #5)

Semua perintah dijalankan dari folder repo di Mac, pada branch
`claude/quirky-gates-s14thj`. Password dan service key **selalu diminta
tersembunyi** (atau diambil dari Keychain Mac). Tidak pernah diketik di baris
perintah, disimpan di file, masuk riwayat shell, atau dipasang di environment
cloud.

| | Produksi | Staging |
|---|---|---|
| Ref | `qlgbjvzabnfqmfnjdkmo` | `mbkmhvcqklikaswlklrz` |
| Yang dilakukan | **hanya membaca skema** (tanpa baris data) | skema + migrasi PR #5 + data sintetis |
| Skrip | `dump-prod-schema.sh` | `run-staging.sh check / prepare / e2e / cleanup` |

## 1. Persiapan (sekali)

```bash
brew install libpq node
echo 'export PATH="$(brew --prefix libpq)/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
psql --version && pg_dump --version        # harus ≥ versi Postgres server (lihat langkah 3)

git fetch origin && git checkout claude/quirky-gates-s14thj && git pull
npm ci
npm i --no-save playwright-core          # hanya untuk uji e2e (langkah 7)
mkdir -p ~/lm-staging && chmod 700 ~/lm-staging   # dump disimpan di sini, DI LUAR repo
```

Opsional — simpan rahasia staging di Keychain supaya tidak perlu mengetik
ulang (perintah akan meminta nilainya secara tersembunyi):

```bash
security add-generic-password -a "$USER" -s lm-staging-anon-key -w
security add-generic-password -a "$USER" -s lm-staging-service-key -w
security add-generic-password -a "$USER" -s lm-staging-db-password -w
```

Password produksi **tidak** disimpan di Keychain oleh panduan ini; diminta tiap kali.

## 2. Ambil host Session pooler

Dashboard Supabase → pilih proyek → **Connect** → **Session pooler**. Catat
**host saja** (mis. `aws-1-ap-southeast-1.pooler.supabase.com`). Port 5432 dan
user `postgres.<ref>` disusun oleh skrip dari ref yang terkunci, jadi tidak
bisa tertukar. Lakukan untuk produksi dan staging. Host-nya bisa sama bila
region sama; yang membedakan proyek adalah user `postgres.<ref>`.

## 3. Dump SKEMA produksi (read-only)

```bash
scripts/staging/dump-prod-schema.sh <HOST_POOLER_PRODUKSI> ~/lm-staging/prod-schema.dump.sql
```

Pemeriksaan otomatis sebelum `pg_dump` berjalan (skrip berhenti bila salah satu gagal):

1. Host harus `…pooler.supabase.com` dan tidak menyebut ref staging.
2. File output harus di luar repo, berakhiran `.dump.sql`, dan belum ada (tidak menimpa).
3. User dikunci ke `postgres.qlgbjvzabnfqmfnjdkmo`, port 5432, SSL wajib.
4. Semua perintah memakai `default_transaction_read_only=on`. Sesi **harus**
   melaporkan `transaction_read_only = on`; bila tidak, skrip berhenti.
5. Versi `pg_dump` ≥ versi server.
6. Anda mengetik ulang ref produksi sebagai konfirmasi.
7. `pg_dump --schema-only --schema=public --no-owner` → hanya katalog, tanpa
   baris tabel. File dibuat dengan mode 600.
8. Hasilnya langsung diperiksa. Bila ternyata berisi data, file **dihapus**.

Contoh output yang benar:

```
✓ host looks like a Supabase Session pooler: aws-1-…pooler.supabase.com
✓ output: /Users/<anda>/lm-staging/prod-schema.dump.sql
Password database PRODUKSI (tidak ditampilkan):
✓ connected as postgres.qlgbjvzabnfqmfnjdkmo; session is read-only (transaction_read_only=on)
✓ pg_dump 17 ≥ server 17
Ketik ref produksi untuk lanjut: qlgbjvzabnfqmfnjdkmo
✓ schema-only dump written (… lines)
```

`pg_dump` hanya mengambil lock ACCESS SHARE saat membaca katalog, jadi
aplikasi produksi tetap bisa membaca dan menulis seperti biasa.

## 4. Tinjau dan bersihkan dump

```bash
npx tsx scripts/staging/check-dump.ts ~/lm-staging/prod-schema.dump.sql
```

Output hanya menampilkan nomor baris dan kata kunci/host (aman dibagikan).
Kode keluar: `0` bersih · `1` perlu ditinjau · `2` berisi data (jangan dipakai).

Bila ada temuan, kerjakan di **salinan** (file asli tetap utuh):

```bash
cp ~/lm-staging/prod-schema.dump.sql ~/lm-staging/prod-schema.clean.dump.sql
chmod 600 ~/lm-staging/prod-schema.clean.dump.sql
open -e ~/lm-staging/prod-schema.clean.dump.sql     # atau editor lain
```

| Temuan | Tindakan di salinan |
|---|---|
| `supabase_functions.http_request` (Database Webhook) | Hapus pernyataan `CREATE TRIGGER …` itu. |
| `net.http_post` / `http_get` di fungsi | Ganti URL-nya dengan `https://staging-disabled.invalid`, atau hapus fungsi dan trigger pemakainya. |
| URL host produksi (domain app / `qlgbjvzabnfqmfnjdkmo`) | Ganti dengan `https://staging-disabled.invalid`. |
| `secret-like literals` | Ganti nilainya dengan `'REDACTED'`. Rahasia produksi tidak boleh sampai ke staging. |
| `grant to non-standard role` | Hapus baris `GRANT` itu, karena role tersebut tidak ada di staging. |
| `extension …` | Biarkan bila memang tersedia di Supabase. |

Lalu bandingkan dan periksa ulang:

```bash
diff -u ~/lm-staging/prod-schema.dump.sql ~/lm-staging/prod-schema.clean.dump.sql | less
npx tsx scripts/staging/check-dump.ts ~/lm-staging/prod-schema.clean.dump.sql
```

URL yang masih tercatat harus hanya `staging-disabled.invalid`. Setelah Anda
yakin, langkah 6–7 memakai flag `--dump-reviewed`.

## 5. Cek koneksi staging (read-only)

```bash
STAGING_DB_HOST=<HOST_POOLER_STAGING> scripts/staging/run-staging.sh check
```

Pemeriksaan ini tidak menulis apa pun:

- pengaman staging (ref/URL/host; kunci atau host produksi ditolak);
- staging menerima anon key dan service key;
- koneksi DB sebagai `postgres.mbkmhvcqklikaswlklrz` dengan sesi read-only;
- laporan versi server, jumlah tabel `public` (untuk proyek baru: 0), marker, dan status bucket.

## 6. Dry run persiapan staging (tanpa menulis)

```bash
STAGING_DB_HOST=<HOST_POOLER_STAGING> scripts/staging/run-staging.sh prepare \
  --schema-dump ~/lm-staging/prod-schema.clean.dump.sql --dry-run --dump-reviewed
```

Output diakhiri `dry run — would apply: schema-dump, 20260923_customer_verified_login.sql, 20260924_satuan_item_photos.sql, seed`.
Bila database staging sudah berisi tabel tanpa marker `lm_staging`, skrip
berhenti. Jangan pakai `--adopt-existing` kecuali Anda yakin itu staging.

## 7. Setelah disetujui (belum dijalankan sekarang)

```bash
STAGING_DB_HOST=<HOST_POOLER_STAGING> scripts/staging/run-staging.sh prepare --schema-dump ~/lm-staging/prod-schema.clean.dump.sql --dump-reviewed
scripts/staging/run-staging.sh e2e          # build terhadap staging + uji end-to-end (butuh Chrome: CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
STAGING_DB_HOST=<HOST_POOLER_STAGING> scripts/staging/run-staging.sh cleanup            # hitung
STAGING_DB_HOST=<HOST_POOLER_STAGING> scripts/staging/run-staging.sh cleanup --execute  # hapus data uji sintetis
```

## Mengapa perintah staging tidak bisa mengenai produksi

- `run-staging.sh` mengunci `STAGING_REF=mbkmhvcqklikaswlklrz` dan
  `STAGING_SUPABASE_URL`, serta menolak nilai rahasia yang memuat ref atau
  kunci produksi.
- `guard.ts` menolak bila ref, URL, host DB, atau kunci JWT milik produksi;
  user DB diturunkan menjadi `postgres.mbkmhvcqklikaswlklrz`; host harus
  Session pooler; port 5432.
- Proyek staging sendiri harus menerima anon key **dan** service key
  (lewat HTTPS) sebelum koneksi DB dibuka.
- `prepare`/`cleanup` mensyaratkan marker `lm_staging` dengan ref staging;
  database lain berhenti di langkah 4.
- Semua SQL memakai `--single-transaction`; migrasi dan seed dicatat supaya
  tidak diterapkan dua kali.
- Dump yang berisi data ditolak dan dihapus.

## Masalah umum

- `pg_dump … older than server` → `brew upgrade libpq`.
- `Tenant or user not found` → host pooler region salah untuk proyek itu, atau ref salah.
- `password authentication failed` → reset password DB di Dashboard → Settings → Database.
