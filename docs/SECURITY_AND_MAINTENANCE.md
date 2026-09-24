# Keamanan & Maintenance Laundrivery (LM)

Dokumen ini wajib dibaca Owner / Admin Ops sebelum production.

## 1. Env production (wajib)

| Variable | Fungsi |
|----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Hanya server. **Jangan** di `NEXT_PUBLIC_*`. |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Client. RLS harus ketat. |
| `CRON_SECRET` | Auth Vercel Cron + ops. |
| `PAYMENT_OPS_SECRET` | Auth tandai lunas / resync / diagnosis / mutasi deposit. |
| `NEXT_PUBLIC_PAYMENT_OPS_SECRET` | **Sama nilai** dengan `PAYMENT_OPS_SECRET` (UI staf). Rotasi berkala. |
| `MAYAR_API_KEY` | Fallback global; utamakan key per outlet. |
| `MAYAR_WEBHOOK_TOKEN` / `MAYAR_WEBHOOK_SECRET` | Verifikasi webhook. |
| `PAYMENT_GATEWAY_SERVER_KEY` | Opsional HMAC. |
| `CUSTOMER_AUTH_SECRET` | Tanda tangan sesi customer + HMAC kode login (≥ 32 karakter). Server-only. |
| `CUSTOMER_WA_LOGIN_ENABLED` / `CUSTOMER_WA_LOGIN_NUMBER` / `EVOLUTION_INSTANCE` / `EVOLUTION_WEBHOOK_TOKEN` | Login WhatsApp terverifikasi (Evolution API). Lihat `docs/customer-verified-login.md`. |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | Opsional: balasan WA "berhasil masuk". |
| `CUSTOMER_EMAIL_LOGIN_ENABLED` / `RESEND_API_KEY` / `CUSTOMER_AUTH_EMAIL_FROM` | Login email cadangan. |
| `CUSTOMER_LEGACY_LOGIN_ENABLED` | Default `true`. Set `false` setelah login WA terverifikasi diuji → login lama (tanpa verifikasi) dimatikan. |
| `STAFF_SESSION_SECRET` | Tanda tangan cookie sesi staf HttpOnly (≥ 32 karakter, server-only), diterbitkan `/api/auth/staff-login`. Wajib untuk fitur yang butuh identitas staf terverifikasi (lihat foto item satuan). |
| `SATUAN_ITEM_PHOTO_ENABLED` | Default mati. `true` hanya setelah migrasi `20260924_satuan_item_photos.sql`, `CUSTOMER_AUTH_SECRET`, `STAFF_SESSION_SECRET`, dan service role terpasang. Selama mati, foto item satuan tidak diminta. |

Tanpa `PAYMENT_OPS_SECRET`/`CRON_SECRET` di production, endpoint mark-manual / resync / diagnosis / deposit **menolak** request.

## 2. SQL yang harus dijalankan di Supabase

Urutan di SQL Editor:

1. Migration payment flags / Mayar / deposit atomic (yang sudah ada).
2. `20260908_payment_security_logs.sql`
3. **`20260910_harden_payment_logs_rls.sql`** — anon tidak baca audit/webhook/error bebas.
4. **`20260910_money_guardrails.sql`** — soft-void; REVOKE DELETE transaksi; RPC deposit hanya service_role.
5. **`20260910_employees_password_rls.sql`** — kolom `password` tidak readable/writable oleh anon.
6. `20260908_outlet_books.sql`, loyalty window, dll.
7. `20260923_customer_verified_login.sql` — tabel login customer (service-role only), sebelum mengaktifkan login WA/email terverifikasi.
8. `20260924_satuan_item_photos.sql` — bucket privat `satuan-item-photos` tanpa policy anon (unggah lewat signed upload URL dari server, lihat lewat API staf). Jalankan sebelum `SATUAN_ITEM_PHOTO_ENABLED=true`.

`pickup_orders.pickup_date` tetap **NOT NULL** di produksi; aplikasi mengisi tanggal lokal hari ini untuk order tanpa jadwal (jemput sekarang, request antar). Tidak ada migrasi yang melonggarkan constraint itu.

Cek cepat:

- Table Editor → RLS on: `error_logs`, `webhook_logs`, `audit_logs`, `deposit_payment_credits`.
- Coba dari browser console dengan anon key: `delete` transaksi harus gagal; `rpc('credit_customer_deposit')` harus gagal.
- Dengan anon key: `storage.from('satuan-item-photos').list()` kosong, `download`/`createSignedUrl` gagal.

### Reset data (opsional, sekali jalan)

Setelah **backup/snapshot**: jalankan [`docs/sql/reset_keep_sorcha_dago.sql`](sql/reset_keep_sorcha_dago.sql) sebagai postgres/service role (bukan anon). Checklist verifikasi: [`docs/sql/VERIFY_AFTER_RESET.md`](sql/VERIFY_AFTER_RESET.md).

## 3. Praktik aman harian

- Jangan bagikan service role / ops secret ke kasir umum (cukup lewat env Vercel + build).
- Rotasi `PAYMENT_OPS_SECRET` + `CRON_SECRET` tiap 90 hari.
- Login staf lewat `/api/auth/staff-login` (password dicek di server, tidak di-select massal di client).
- Mayar: webhook hanya `/api/webhooks/mayar`.
- Setelah deploy: uji cron `Authorization: Bearer $CRON_SECRET` → `/api/cron/sync-payments`.
- Owner → Diagnosa: butuh ops secret cocok di client & server.
- **Void transaksi = soft-void** (`is_void`), bukan hapus baris — jejak uang investor tetap ada.

## 4. Maintenance performa (halaman tidak berat)

| Area | Aturan |
|------|--------|
| Finance owner | Max **1 tahun** / ~3000 tx |
| Foto bukti | Tombol **Lihat** (deferred), jangan auto-load semua |
| Diagnosis badge | Poll API ringkas tiap ~90s, bukan realtime `error_logs` anon |
| Cron sync | ~60 pending, cache key Mayar per outlet |
| Select | Hindari `select('*')` di list besar; kolom spesifik |

## 5. Fraud checklist mingguan (15 menit)

1. `audit_logs`: `PAYMENT_MANUAL_VERIFIED`, `PAYMENT_RESYNC`, `DEPOSIT_CREDIT`, `DEPOSIT_DEBIT`.
2. Tx `is_paid` true tapi `paid_via` kosong → investigasi.
3. Soft-void baru: filter `is_void = true` minggu ini — cocokkan alasan.
4. Pickup bentrok `transaction_id` → claim POS.
5. Saldo deposit vs log topup SUCCESS.

## 6. Sarang keamanan (roadmap investor-safe)

**Sudah dikunci sekarang**

- Webhook Mayar → satu path `markGatewayPaid` + service role.
- Mark manual / resync / diagnosis / mutasi deposit → Bearer ops secret + role.
- Log pembayaran: RLS deny anon.
- Hard-delete transaksi diblok di DB untuk anon; UI soft-void.
- RPC credit/debit deposit dicabut dari anon.
- **Password karyawan**: scrypt hash; login + CRUD lewat API; kolom `password` tidak di-grant ke anon (`20260910_employees_password_rls.sql`).
- **Owner tunggal**: `/owner/dashboard` redirect ke `/owner` (tab Approvals digabung).

**Masih terbuka (prioritas berikutnya)**

1. **RLS penuh** pada `transactions`, `customers`, `membership_logs` — butuh Supabase Auth staf.
2. Cabut `grant all … to anon` pada `cash_deposits`, loyalty, `cashflow_logs` setelah write pindah ke API.
3. Hapus `NEXT_PUBLIC_PAYMENT_OPS_SECRET`; ganti JWT sesi staf.
4. Rotasi publishable key yang pernah ter-commit di source.

## 7. Cara maintenance rutin

| Frekuensi | Tugas |
|-----------|--------|
| Harian | Cek Diagnosa Sistem (error unresolved + pending bayar). |
| Mingguan | Checklist fraud §5 + samakan omset Mayar vs `paid_via`. |
| Bulanan | Vacuum/index Supabase jika lambat; arsip foto lama; review void. |
| 90 hari | Rotasi secrets; review karyawan aktif; revoke akses yang keluar. |
| Insiden | Matikan webhook Mayar sementara → ganti `PAYMENT_OPS_SECRET` → redeploy → audit 48 jam. |

## 8. Kontak insiden

Dugaan kebocoran uang: (1) matikan webhook gateway, (2) rotasi ops + cron secret, (3) pastikan `SUPABASE_SERVICE_ROLE_KEY` tidak di client, (4) audit `audit_logs` + soft-void + deposit credit tanpa paymentId gateway.
