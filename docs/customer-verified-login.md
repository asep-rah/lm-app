# Login Customer Terverifikasi (WhatsApp via Evolution API + Email Cadangan)

**Status:** diimplementasikan di kode, **belum aktif di produksi**. Aktif hanya setelah variabel lingkungan di bawah diisi dan alur diuji.
**Risiko:** L4 (auth). Wajib review manusia sebelum diaktifkan.

## 1. Ringkasan alur

### WhatsApp (utama)

```
Browser                         LM App (server)                     Evolution API (nomor sistem)
  │ 1. nomor WA ─────────────────▶ /api/customer/auth/wa/start
  │                                 • buat challenge (kode LDRV-XXXXXX, 5 menit, sekali pakai)
  │                                 • simpan HMAC kode + HMAC nonce browser
  │ ◀── kode + link wa.me + cookie nonce (HttpOnly)
  │ 2. buka WhatsApp (pesan terisi) → customer MENEKAN KIRIM ke nomor sistem ─────────▶
  │                                                                   │ webhook MESSAGES_UPSERT
  │                                 /api/webhooks/evolution ◀──────────┘
  │                                 • cek token webhook, instance, event, bukan grup/fromMe
  │                                 • kode ada, pending, belum kedaluwarsa
  │                                 • nomor pengirim == nomor yang diketik di web
  │                                 • pending → verified (atomik, id pesan = anti-replay)
  │ 3. polling tiap 2,5 dtk ───────▶ /api/customer/auth/wa/status?id=…
  │                                 • hanya browser dengan cookie nonce yang sama
  │                                 • verified → consumed (sekali pakai) → cookie sesi
  │ ◀── cookie sesi HttpOnly (ldrv_cust_session, 30 hari, HMAC)
```

Customer **tidak menyalin OTP** ke web. Kode lama `LDRV-1234` (4 digit, dibuat di browser) **tidak** diterima webhook.

### Email (cadangan)

- **Menautkan email**: hanya dari sesi terverifikasi → Profil → *Email cadangan* → kode 6 digit dikirim ke email → email tertaut setelah kode benar. Satu email hanya untuk satu akun (unique index); email milik akun lain ditolak (409), **tidak digabung**.
- **Masuk dengan email**: hanya email yang sudah tertaut & terverifikasi. Selalu masuk ke akun (nomor WA) yang sama, sehingga riwayat pesanan tidak terpecah. Email yang tidak terdaftar mendapat respons generik yang sama (anti-enumerasi) dan tidak dikirimi email.
- Kode 6 digit berlaku 10 menit, maksimal 5 kali salah, sekali pakai, terikat ke browser yang meminta.

### Login lama (legacy)

Alur lama (kode dibuat di browser, WA ke nomor admin, tombol "Saya sudah kirim", tanpa verifikasi server) **tetap berjalan** selama `CUSTOMER_WA_LOGIN_ENABLED` belum `true`. Ini sengaja: login produksi tidak diputus sebelum pengganti diuji.

| Kondisi | Halaman login | Form nomor di dashboard | Nomor tersimpan di localStorage tanpa cookie sesi |
|---|---|---|---|
| Default (belum dikonfigurasi) | alur lama | tampil (seperti sekarang) | diterima |
| WA aktif, `CUSTOMER_LEGACY_LOGIN_ENABLED` belum `false` | WA terverifikasi | diganti tombol "Masuk dengan WhatsApp" | masih diterima (pelanggan lama tidak dipaksa logout) |
| WA aktif + `CUSTOMER_LEGACY_LOGIN_ENABLED=false` | WA terverifikasi | tombol login | **ditolak** — customer harus verifikasi ulang |

## 2. Variabel lingkungan (Vercel → Project → Settings → Environment Variables)

Semua **server-only**. Jangan beri awalan `NEXT_PUBLIC_`. Jangan commit nilai ke Git.

| Variabel | Wajib untuk | Keterangan |
|---|---|---|
| `CUSTOMER_AUTH_SECRET` | WA & email | String acak ≥ 32 karakter (mis. `openssl rand -base64 48`). Untuk tanda tangan sesi & HMAC kode. Mengganti nilainya = semua sesi customer terverifikasi logout. |
| `SUPABASE_SERVICE_ROLE_KEY` | WA & email | Sudah ada. Tabel login hanya bisa diakses service role. |
| `CUSTOMER_WA_LOGIN_ENABLED` | WA | `true` untuk mengaktifkan. |
| `CUSTOMER_WA_LOGIN_NUMBER` | WA | Nomor WhatsApp **sistem** yang terhubung ke instance Evolution (format `62…`). Bukan nomor pribadi. |
| `EVOLUTION_INSTANCE` | WA | Nama instance Evolution untuk login (mis. `laundrivery-login`). |
| `EVOLUTION_WEBHOOK_TOKEN` | WA | Token acak ≥ 24 karakter; dipakai di URL webhook. |
| `EVOLUTION_API_URL` | balasan WA (opsional) | Base URL Evolution API, mis. `https://evo.domain-anda.id`. |
| `EVOLUTION_API_KEY` | balasan WA (opsional) | API key instance/global Evolution untuk `sendText`. |
| `CUSTOMER_WA_LOGIN_REPLY` | opsional | `false` untuk mematikan pesan balasan "Berhasil" ke customer. Default aktif. |
| `CUSTOMER_EMAIL_LOGIN_ENABLED` | email | `true` untuk mengaktifkan email cadangan. |
| `RESEND_API_KEY` | email | API key [Resend](https://resend.com). |
| `CUSTOMER_AUTH_EMAIL_FROM` | email | Pengirim terverifikasi di Resend, mis. `Laundrivery <login@mail.domain-anda.id>`. |
| `RESEND_API_URL` | uji saja | Override base URL Resend (untuk server tiruan). Jangan diisi di produksi. |
| `CUSTOMER_LEGACY_LOGIN_ENABLED` | migrasi | Default `true`. Set `false` **setelah** WA terverifikasi diuji di produksi. |
| `CUSTOMER_LEGACY_LOGIN_WA` | legacy | Nomor tujuan alur lama. Default = nomor yang dipakai sebelumnya (`6285172141494`). |

Fitur yang variabelnya belum lengkap otomatis **nonaktif** (endpoint menjawab 503, UI tidak menampilkannya).

## 3. Database

Jalankan migrasi `supabase/migrations/20260923_customer_verified_login.sql` di Supabase SQL Editor (staging dulu).

- Hanya **menambah** 2 tabel: `customer_login_challenges`, `customer_auth_identities`. Tidak mengubah tabel lama, tidak perlu backfill.
- RLS aktif tanpa policy + `revoke all` dari `anon`/`authenticated` → tidak bisa dibaca dari browser.
- Kode & nonce disimpan sebagai HMAC, bukan teks asli.
- Rollback: `drop table` kedua tabel (tidak ada tabel lain yang mereferensikan).
- Rekomendasi pemeliharaan: hapus baris `customer_login_challenges` berumur > 30 hari secara berkala (belum diotomatisasi).

## 4. Menyiapkan instance Evolution API

> Langkah di bawah mengikuti Evolution API v2. Cocokkan dengan dokumentasi versi yang Anda pasang.

1. **Gunakan nomor WhatsApp khusus sistem** (bukan nomor pribadi/CS yang dipakai manual).
2. Buat instance:
   ```bash
   curl -X POST "$EVOLUTION_API_URL/instance/create" \
     -H "apikey: $EVOLUTION_GLOBAL_API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"laundrivery-login","integration":"WHATSAPP-BAILEYS","qrcode":true}'
   ```
3. Hubungkan nomor: `GET $EVOLUTION_API_URL/instance/connect/laundrivery-login` → scan QR dari WhatsApp nomor sistem (Perangkat Tertaut).
4. Pasang webhook **khusus instance ini**, hanya event pesan masuk:
   ```bash
   curl -X POST "$EVOLUTION_API_URL/webhook/set/laundrivery-login" \
     -H "apikey: $EVOLUTION_GLOBAL_API_KEY" -H "Content-Type: application/json" \
     -d '{"webhook":{"enabled":true,
          "url":"https://lm-coral.vercel.app/api/webhooks/evolution?token=<EVOLUTION_WEBHOOK_TOKEN>",
          "byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}'
   ```
   Token juga diterima lewat header `x-webhook-token` atau `Authorization: Bearer` bila versi Evolution Anda mendukung header webhook.
5. Isi `EVOLUTION_INSTANCE=laundrivery-login`, `CUSTOMER_WA_LOGIN_NUMBER=<nomor sistem 62…>`, `EVOLUTION_WEBHOOK_TOKEN`, (opsional) `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` untuk balasan.

Catatan untuk `docker-compose.yml` yang ada di repo: `WEBHOOK_GLOBAL_URL` mengirim **semua** event ke n8n. Pesan login juga akan terkirim ke sana. Itu tidak membuka celah login (kode hanya bisa diselesaikan oleh browser yang memegang cookie nonce), tetapi sebaiknya instance login dikecualikan dari webhook global atau n8n mengabaikan pesan `LDRV-…`. Lihat juga temuan keamanan di bagian 8.

## 5. Penyedia email (Resend)

1. Buat akun Resend, verifikasi domain pengirim (SPF/DKIM).
2. Buat API key dengan izin *sending*.
3. Isi `RESEND_API_KEY`, `CUSTOMER_AUTH_EMAIL_FROM`, `CUSTOMER_EMAIL_LOGIN_ENABLED=true`.

Penyedia lain bisa dipakai dengan mengganti `sendEmailCode()` di `lib/customerAuth/server.ts` (adapter tunggal).

## 6. Uji sebelum produksi (staging / Preview Vercel)

1. Jalankan migrasi di project Supabase staging.
2. Isi env di Preview (bukan Production). Biarkan `CUSTOMER_LEGACY_LOGIN_ENABLED` kosong.
3. `GET /api/customer/auth/session` → `config.whatsapp: true`.
4. Buka `/customer/login` di HP → masukkan nomor → tekan **Buka WhatsApp** → tekan **Kirim** di WhatsApp → halaman masuk otomatis dalam beberapa detik.
5. Uji negatif:
   - kirim kode dari nomor lain → web menampilkan "nomor berbeda";
   - tunggu > 5 menit lalu kirim → "kedaluwarsa";
   - kirim ulang pesan yang sama → tidak ada efek;
   - salin URL ke browser lain → tidak bisa menyelesaikan login.
6. Profil → Email cadangan → tautkan → logout → masuk via tab **Email** → riwayat pesanan sama.
7. Cek `audit_logs` untuk `CUSTOMER_LOGIN_WHATSAPP`, `CUSTOMER_LOGIN_EMAIL`, `CUSTOMER_EMAIL_LINKED`.
8. Setelah lolos di Production dengan WA aktif beberapa hari, set `CUSTOMER_LEGACY_LOGIN_ENABLED=false`.

Uji otomatis lokal (tanpa kredensial nyata, database & provider tiruan):

```bash
npm test                                          # unit
npm run build && node scripts/e2e/customer-auth.e2e.mjs      # 26 skenario API login
npm i --no-save playwright-core && CHROMIUM_PATH=/path/chrome node scripts/e2e/customer-order.e2e.mjs  # UI
```

## 7. Batasan yang diketahui

- **Akses data customer masih lewat anon key di browser** (kode lama: dashboard membaca `transactions`, `pickup_orders`, `customers` langsung dengan filter nomor). Login terverifikasi membuktikan kepemilikan nomor pada saat login, tetapi belum menjadi batas otorisasi data. Menutupnya membutuhkan RLS/endpoint server per customer (lihat `SECURITY_AND_MAINTENANCE.md` §6 "Masih terbuka") dan berada di luar cakupan perubahan ini.
- Jika `/api/customer/auth/session` gagal dijangkau, UI jatuh ke perilaku lama agar layanan tidak putus.
- Pola "customer mengirim kode ke sistem" rentan dimanipulasi jika customer dibujuk mengirim kode milik orang lain. Pesan WhatsApp dan balasan sistem menyertakan peringatan "jangan kirim kode dari orang lain".
- Sesi berbasis cookie tanda tangan tanpa daftar pencabutan. Logout menghapus cookie; untuk mencabut semua sesi, rotasi `CUSTOMER_AUTH_SECRET`.
- WhatsApp dengan pengalamatan LID tanpa nomor telepon di payload tidak bisa diverifikasi, sehingga login ditolak dengan pesan jelas.

## 8. Temuan keamanan terkait (di luar cakupan, belum diubah)

`docker-compose.yml` di Git memuat `AUTHENTICATION_API_KEY` Evolution, password Postgres Evolution, IP server, dan URL webhook n8n. Anggap **sudah bocor**: rotasi API key & password, pindahkan ke `.env` yang tidak di-commit, lalu ganti URL webhook n8n bila perlu.
