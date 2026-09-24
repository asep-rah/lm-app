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

### Mengapa `transaction_read_only=off` lewat Session pooler

`PGOPTIONS="-c default_transaction_read_only=on"` dikirim libpq sebagai
parameter startup `options`. **Supavisor (Session pooler) tidak meneruskan
parameter itu ke Postgres**, jadi sesi tetap `off`. Hal ini sudah
direproduksi pada Supavisor lokal: koneksi langsung → `on`, lewat pooler →
`off`. Pemeriksaan skrip sudah benar dengan berhenti. Perintah `SET` atau
`BEGIN TRANSACTION READ ONLY` **di dalam** sesi tetap berlaku lewat pooler.

Pilih salah satu jalur. Keduanya tidak mengubah role, setting, atau objek
apa pun di produksi.

| Jalur | Host | Pemaksaan read-only |
|---|---|---|
| **Langsung** (bila Mac punya IPv6) | `db.qlgbjvzabnfqmfnjdkmo.supabase.co` | `PGOPTIONS` sampai ke Postgres; seluruh sesi `transaction_read_only=on` (pemeriksaan lama, tidak berubah) |
| **Session pooler** (IPv4) | `<region>.pooler.supabase.com` | probe `psql` di dalam `BEGIN TRANSACTION READ ONLY` (harus `on`); `pg_dump` hanya boleh jalan bila binary yang sama sudah **dibuktikan** di langkah 3a |

Cek IPv6 Mac: `ping6 -c1 db.qlgbjvzabnfqmfnjdkmo.supabase.co`. Bila berhasil,
jalur langsung lebih sederhana dan langkah 3a tidak diperlukan.

### 3a. Bukti read-only `pg_dump` (wajib untuk jalur pooler, dijalankan lokal)

Uji ini memakai stack Supabase **lokal** (Docker Desktop) dengan Supavisor
mode session. Tidak ada koneksi ke produksi. Setiap statement yang dikirim
`pg_dump` Anda lewat pooler dicatat, lalu diperiksa:

- `pg_dump` membuka `SET TRANSACTION … READ ONLY`;
- sebelum itu hanya ada pengaturan **sesi** (`DISCARD ALL`, `SET …`, `set_config(…, false)`);
- seluruh statement hanya SELECT / LOCK … ACCESS SHARE / PREPARE … AS SELECT / EXECUTE / BEGIN;
- dump tidak berisi baris data, dan data uji tidak berubah.

Bila lulus, stempel `~/lm-staging/.pgdump-readonly-proof` ditulis, berisi
path dan versi `pg_dump`. Skrip dump menolak jalur pooler tanpa stempel yang
cocok persis.

```bash
mkdir -p ~/lm-ro-proof && cd ~/lm-ro-proof
npx supabase@2 init --force
# aktifkan pooler mode session:
sed -i '' -e '/^\[db.pooler\]/,/^\[/ s/^enabled = false/enabled = true/' \
          -e '/^\[db.pooler\]/,/^\[/ s/^pool_mode = "transaction"/pool_mode = "session"/' supabase/config.toml
npx supabase@2 start -x realtime,studio,edge-runtime,logflare,vector,imgproxy,mailpit,postgres-meta,gotrue,storage-api,postgrest,kong
cd -   # kembali ke repo
scripts/staging/prove-pgdump-readonly.sh
(cd ~/lm-ro-proof && npx supabase@2 stop --no-backup)
```

Output yang benar diakhiri:

```
• pooler + PGOPTIONS → transaction_read_only=off (off = startup options are dropped by Supavisor)
✓ BEGIN TRANSACTION READ ONLY through the pooler → transaction_read_only=on
✓ captured 67 statements issued by pg_dump through the pooler
✓ pg_dump opens a READ ONLY transaction (statement 16)
✓ before it: only session-local settings (DISCARD/SET/set_config(…, false))
✓ all statements: SELECT/SET/LOCK(ACCESS SHARE)/PREPARE…AS SELECT/EXECUTE/BEGIN/DISCARD
✓ dump contains schema only; fixture row untouched
✓ proof stamp written: /Users/<anda>/lm-staging/.pgdump-readonly-proof (pg_dump (PostgreSQL) 17.x)
```

(Jumlah statement bisa berbeda per versi. Yang wajib hanyalah semua baris `✓`.)
Bila `brew upgrade libpq` mengganti versi `pg_dump`, jalankan ulang 3a.

### 3b. Dump

```bash
scripts/staging/dump-prod-schema.sh <HOST> ~/lm-staging/prod-schema.dump.sql
#   <HOST> = db.qlgbjvzabnfqmfnjdkmo.supabase.co   (langsung)  atau  host Session pooler produksi
```

Pemeriksaan sebelum `pg_dump` berjalan (skrip berhenti bila salah satu gagal):

1. Host = `db.qlgbjvzabnfqmfnjdkmo.supabase.co` atau `…pooler.supabase.com`,
   dan tidak menyebut ref staging. User dikunci: `postgres` (langsung) atau
   `postgres.qlgbjvzabnfqmfnjdkmo` (pooler). Port 5432, SSL wajib.
2. File output di luar repo, berakhiran `.dump.sql`, belum ada.
3. Jalur pooler: stempel 3a cocok dengan path **dan** versi `pg_dump`.
4. Probe koneksi berjalan di dalam `BEGIN TRANSACTION READ ONLY` dan harus
   `transaction_read_only = on`.
5. Jalur langsung: sesi harus `transaction_read_only = on`. Jalur pooler:
   nilai sesi `off` dilaporkan apa adanya; yang dipakai adalah transaksi
   READ ONLY milik `pg_dump` yang sudah dibuktikan.
6. Versi `pg_dump` ≥ versi server.
7. Anda mengetik ulang ref produksi.
8. `pg_dump --schema-only --schema=public --no-owner --lock-wait-timeout=5000`,
   mode file 600. Bila berisi data, file dihapus.

Contoh output jalur pooler:

```
✓ mode: pooler (aws-1-…pooler.supabase.com, user postgres.qlgbjvzabnfqmfnjdkmo)
✓ output: /Users/<anda>/lm-staging/prod-schema.dump.sql
✓ read-only proof matches this pg_dump (pg_dump (PostgreSQL) 17.x)
Password database PRODUKSI (tidak ditampilkan):
✓ connected as postgres.qlgbjvzabnfqmfnjdkmo; probes ran in a READ ONLY transaction (transaction_read_only=on)
• pooler: session default transaction_read_only=off (startup options are dropped by Supavisor); relying on the proven pg_dump READ ONLY transaction
✓ pg_dump 17 ≥ server 17
Ketik ref produksi untuk lanjut: qlgbjvzabnfqmfnjdkmo
✓ schema-only dump written (… lines)
```

`LOCK … IN ACCESS SHARE MODE` hanya menunggu DDL. Baca dan tulis aplikasi
produksi tetap berjalan, dan `--lock-wait-timeout=5000` membatalkan dump
bila ada DDL yang sedang berjalan.

Tidak dipakai, karena mengubah produksi: memberi password pada role bawaan
`supabase_read_only_user`, `ALTER ROLE … SET default_transaction_read_only`,
atau `supabase db dump --linked` (yang membuat role login sementara).

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
