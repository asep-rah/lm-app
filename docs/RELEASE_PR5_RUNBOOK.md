# Runbook rilis PR #5 ke produksi

Jalankan **hanya setelah PR #5 disetujui dan di-merge**. Setiap langkah di
produksi dilakukan manusia lewat Supabase **SQL Editor produksi** dan Vercel.
Staging (`mbkmhvcqklikaswlklrz`) sudah lolos E2E 30/30 dengan migrasi yang
sama.

Semua migrasi idempoten, artinya aman dijalankan ulang bila terputus. Jalankan
**satu file per eksekusi**, persis dengan isi file di `supabase/migrations/`.

## 0. Sebelum mulai

- [ ] PR #5 disetujui dan di-merge ke `main`, tetapi **deploy produksi belum dijalankan**.
      Bila Vercel otomatis deploy saat merge, jeda dulu atau rilis di jam sepi (lihat langkah 2).
- [ ] Backup: Supabase Dashboard produksi → Database → Backups. Pastikan ada
      backup harian terbaru, atau buat backup/PITR sebelum mulai.
- [ ] Env Vercel (Production) terisi: `CUSTOMER_AUTH_SECRET`, `STAFF_SESSION_SECRET`,
      `PAYMENT_OPS_SECRET` (atau `CRON_SECRET`), `SUPABASE_SERVICE_ROLE_KEY`.
      Hapus `XENDIT_SECRET_KEY` / `XENDIT_WEBHOOK_VERIFICATION_TOKEN` bila ada.
      Jangan ubah `SATUAN_ITEM_PHOTO_ENABLED` (fitur foto tetap mati).

Cek awal (read-only), simpan hasilnya untuk dibandingkan:

```sql
select c.relname,
       has_table_privilege('service_role', c.oid, 'SELECT') s,
       has_table_privilege('service_role', c.oid, 'INSERT') i,
       has_table_privilege('service_role', c.oid, 'UPDATE') u,
       has_table_privilege('anon', c.oid, 'INSERT') anon_i
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('audit_logs','error_logs','pickup_orders','system_tasks','deposit_topups','webhook_logs')
order by 1;
```

## 1. Migrasi sebelum deploy (urutan ini)

| # | File | Isi singkat |
|---|---|---|
| 1 | `20260923_customer_verified_login.sql` | 2 tabel login terverifikasi (RLS, tanpa akses anon) |
| 2 | `20260924_satuan_item_photos.sql` | bucket privat `satuan-item-photos` |
| 3 | `20260925_service_role_log_grants.sql` | service_role SELECT/INSERT `audit_logs`, `error_logs` |
| 4 | `20260926_customer_order_server_grants.sql` | service_role SELECT/INSERT `pickup_orders`, `system_tasks`; hapus policy "allow full access for anon" di tabel log |
| 5 | `20260927_service_role_server_grants.sql` | 43 hak kode server di 21 tabel (tanpa DELETE) |
| 6 | `20260929_service_role_sequence_usage.sql` | USAGE sequence di default tabel yang boleh di-INSERT service_role |

Setelah langkah 1–6, jalankan lagi query cek awal. Harapannya:

- `s`/`i` untuk `service_role` bernilai `true` di tabel-tabel itu;
- `anon_i` untuk `pickup_orders` **masih `true`**, karena belum dicabut.

Aplikasi lama tetap berjalan normal: migrasi 1–6 hanya menambah tabel dan hak.

## 2. Deploy aplikasi

- Deploy commit `main` yang berisi PR #5 ke Production di Vercel.
- Cek `https://<domain>/api/health/db-target`: target produksi, kunci diterima.
- Uji singkat dengan akun/nomor internal:
  - buat 1 pesanan jemput dari aplikasi pelanggan;
  - pastikan pesanan muncul di POS/CS/driver dan tugas driver+CS terbentuk;
  - buka `/owner/system-health` dan pastikan tidak ada error baru `customer_order_create`.

## 3. Migrasi setelah deploy

| # | File | Isi singkat |
|---|---|---|
| 7 | `20260928_revoke_anon_pickup_insert.sql` | cabut INSERT anon/authenticated di `pickup_orders` |

**Jangan jalankan sebelum langkah 2 selesai.** Aplikasi lama masih membuat
pesanan dari browser dan akan gagal bila hak ini sudah dicabut.

Setelah itu, cek ulang dengan query cek awal:

- `anon_i` untuk `pickup_orders` sekarang `false`;
- buat 1 pesanan uji lagi: harus tetap berhasil, karena dibuat server.

## 4. Setelah rilis

- [ ] Cocokkan pembayaran top-up deposit di dashboard Mayar dengan saldo
      pelanggan. `deposit_topups` kosong sebelum rilis, jadi top-up yang sudah
      dibayar perlu dikredit manual lewat kasir.
- [ ] Pantau `/owner/system-health` (error_logs) 1–2 hari. Log server kini tidak
      lagi hilang diam-diam.
- [ ] Hapus pesanan uji internal (bila dibuat) lewat alur batal yang biasa.
- [ ] Fitur foto tetap mati (`SATUAN_PHOTO_PRODUCTION_RELEASED = false`) sampai
      review otorisasi staf selesai dan pemilik memutuskan.

## Rollback

- **Masalah setelah langkah 3** (ada jalur browser yang terlewat):
  ```sql
  grant insert on table public.pickup_orders to anon, authenticated;
  ```
- **Masalah aplikasi setelah deploy:** rollback deploy di Vercel ke versi
  sebelumnya.
  - Bila langkah 3 sudah dijalankan, jalankan juga grant INSERT di atas, karena
    aplikasi lama menulis pesanan dari browser.
  - Migrasi 1–6 boleh dibiarkan: hanya menambah hak dan tabel, dan tidak
    mengganggu aplikasi lama.
- Jangan menghapus tabel `customer_login_challenges` / `customer_auth_identities`
  bila sudah berisi data login.

## Catatan untuk migrasi berikutnya

*Default privileges* produksi tidak memberi `service_role` hak baca/tulis pada
tabel baru. Setiap migrasi yang membuat tabel yang dipakai server harus
menyertakan `grant … to service_role` secara eksplisit. Periksa dengan
`npx tsx scripts/staging/service-role-needs.ts <salinan skema staging>`.
