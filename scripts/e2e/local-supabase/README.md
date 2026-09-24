# E2E terhadap Supabase lokal (bukan mock, bukan produksi)

Menjalankan alur pesanan (segera & terjadwal), unggah/akses foto item satuan,
serta tampilan POS/CS/driver terhadap stack Supabase asli yang berjalan di
mesin ini (Postgres + PostgREST + Storage + Kong lewat Supabase CLI).
Runner menolak URL non-lokal dan menggagalkan tes bila browser mencoba
menghubungi `*.supabase.co`.

```bash
# 1. Stack lokal (butuh Docker)
mkdir -p /tmp/sb && cd /tmp/sb && npx supabase@2 init --force
npx supabase@2 start -x gotrue,realtime,studio,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit,postgres-meta
#    Kunci lokal (sb_publishable_… / sb_secret_…) ada di output `supabase status`.

# 2. Build aplikasi terhadap stack lokal
cd <repo>
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable> npm run build

# 3. Jalankan (schema.sql + seed.sql + migrasi foto diterapkan ulang setiap run)
npm i --no-save playwright-core
LOCAL_SB_URL=http://127.0.0.1:54321 LOCAL_SB_ANON=<publishable> LOCAL_SB_SERVICE=<secret> \
LOCAL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
CHROMIUM_PATH=/path/to/chrome node scripts/e2e/local-supabase/run.mjs
```

`schema.sql` hanya perkiraan tabel produksi (dibangun dari kolom yang dipakai
kode + migrasi repo, termasuk `pickup_orders.pickup_date NOT NULL`). Uji di
staging tetap diperlukan sebelum produksi.
