# Buku Manual Pengguna & Teknis — Laundrivery (LM)

**Versi dokumen:** 2026-09-10  
**Audience:** Owner, Investor, Admin Ops, Supervisor, CS, Kasir, Driver, dan tim teknis  
**Aplikasi:** Progressive Web App (PWA) operasional laundry multi-outlet  

Dokumen terkait:

- [Keamanan & Maintenance](./SECURITY_AND_MAINTENANCE.md)
- [Cron pembayaran](./payment-security-cron.md)

---

## Daftar Isi

1. [Ringkasan Sistem & Arsitektur Utama](#1-ringkasan-sistem--arsitektur-utama)
2. [Peta Role & Alur Kerja Lengkap](#2-peta-role--alur-kerja-workflow-lengkap)
3. [Peningkatan & Logika Otomatis](#3-daftar-peningkatan--logika-otomatis-improvements--hidden-logic)
4. [Troubleshooting & FAQ](#4-panduan-troubleshooting--faq-cara-solving-mandiri)
5. [Lampiran teknis singkat](#5-lampiran-teknis-singkat)

---

## 1. Ringkasan Sistem & Arsitektur Utama

### 1.1 Overview aplikasi

**Laundrivery (LM)** adalah sistem operasional laundry berbasis web yang berjalan sebagai PWA. Satu basis kode melayani:

| Portal | URL utama | Pengguna |
|--------|-----------|----------|
| Pelanggan | `/customer/dashboard` | Customer / member |
| Kasir POS | `/pos` | Kasir / crew outlet |
| CS Workspace | `/cs/workspace` | CS Care, Head CS |
| Driver | `/driver/dashboard` | Kurir internal |
| Owner | `/owner` | Owner, finance, supervisor |

Sistem menghubungkan **jemput–cuci–antar**, **pembayaran QRIS (Mayar)**, **deposit member**, **loyalitas tier**, **antrean mesin**, hingga **laporan keuangan (P&L berbasis COA)** dan **diagnosis kesehatan pembayaran**.

### 1.2 Tech stack

| Lapisan | Teknologi | Peran |
|---------|-----------|--------|
| Frontend / API | **Next.js App Router** + **TypeScript** | Halaman UI, Route Handlers (`app/api/*`) |
| Styling | **Tailwind CSS** | UI responsif mobile-first |
| Database & Realtime | **Supabase** (Postgres + Realtime) | Data transaksi, chat, absensi; RLS untuk tabel sensitif |
| Auth staf | `/api/auth/staff-login` + sesi `localStorage` | Password di-hash **scrypt** di server |
| Payment | **Mayar.id** (QRIS) | Webhook + polling + cron catch-up |
| Peta | **Leaflet** + Nominatim (pin/cari alamat); **Google Maps** (navigasi rute & rating outlet) | Lihat §1.3 |
| Deploy | Vercel (+ Cron di `vercel.json`) | Production & jadwal otomatis |

> **Catatan arsitektur:** Operasi uang kritis (tandai lunas, resync, mutasi deposit, diagnosis) wajib lewat **API server** dengan `SUPABASE_SERVICE_ROLE_KEY` + `PAYMENT_OPS_SECRET`. Client tidak boleh memegang service role.

### 1.3 Peta & lokasi

| Fitur | Implementasi di LM | Catatan |
|-------|-------------------|---------|
| Pinpoint lokasi pelanggan | Komponen peta **Leaflet** + GPS / reverse geocode | Bukan Google Places Autocomplete |
| Saran alamat (search) | **Nominatim (OpenStreetMap)** | `AddressSuggest` / pencarian alamat |
| Navigasi driver / POS / CS | Tombol buka **Google Maps Directions** (`maps/dir`) | Deep-link ke app Maps |
| Rating Google outlet | `/api/outlets/google-rating` | Memakai key Places/Maps di server |

Alur tipikal pelanggan:

1. Buka order → pilih / pin lokasi rumah.
2. Sistem hitung jarak & saran **outlet terdekat yang buka**.
3. Driver / kasir membuka navigasi Google Maps ke koordinat yang tersimpan.

### 1.4 Payment Gateway — Webhook & Polling

```
[Pelanggan/POS bayar QRIS Mayar]
        │
        ├─► Webhook  POST /api/webhooks/mayar     (utama, real-time)
        │              verify token/signature
        │              → markGatewayPaid / credit deposit
        │
        ├─► Polling  GET  /api/pay/check-status   (tombol "Cek Status")
        │
        └─► Cron     GET  /api/cron/sync-payments  (tiap 15 menit)
                       catch-up tx pending 5 menit – 7 hari
```

| Jalur | Kapan dipakai |
|-------|----------------|
| **Webhook** | Mayar mengirim event paid → server tandai lunas idempotent |
| **Check-status** | User/CS menekan cek manual jika UI masih “menunggu” |
| **Cron** | Webhook hilang / lambat; server poll Mayar per `mayar_payment_id` |
| **Mark manual** | Override CS/Owner dengan bukti + catatan (audit) |

Alias webhook: `/api/mayar/webhook` mengarah ke handler yang sama. Gateway pembayaran hanya Mayar; route Xendit lama (`/qris/webhook`, `/api/qris/webhook`, `/api/qris/charge`) sudah dihapus.

### 1.5 Diagram arsitektur ringkas

```
┌─────────────┐    HTTPS     ┌──────────────────┐    service role    ┌────────────┐
│ PWA Client  │ ───────────► │ Next.js API / UI │ ─────────────────► │  Supabase  │
│ (roles)     │ ◄─ Realtime─ │ + Cron Vercel    │ ◄───────────────── │  Postgres  │
└─────────────┘              └────────┬─────────┘                    └────────────┘
                                      │
                                      ▼
                               ┌─────────────┐
                               │  Mayar QRIS │
                               └─────────────┘
```

---

## 2. Peta Role & Alur Kerja (Workflow) Lengkap

### 2.1 Customer Portal (`/customer`)

**Entry:** `/customer` → `/customer/dashboard`  
**Login pelanggan:** `/customer/login`  
**Loyalitas:** `/customer/loyalty`

#### Alur registrasi & sesi

1. Pelanggan masuk di `/customer/login`:
   - **WhatsApp terverifikasi** (bila `CUSTOMER_WA_LOGIN_ENABLED=true`): isi nomor → buka WhatsApp dengan pesan kode terisi → tekan **Kirim** ke nomor sistem → web masuk otomatis setelah webhook Evolution memverifikasi nomor pengirim. Sesi = cookie HttpOnly 30 hari.
   - **Email cadangan** (bila `CUSTOMER_EMAIL_LOGIN_ENABLED=true`): hanya email yang sudah ditautkan & diverifikasi dari Profil; masuk ke akun (nomor WA) yang sama.
   - **Login lama** (default selama WA belum dikonfigurasi): kode dibuat di browser + WA ke nomor admin, tanpa verifikasi server.
   - Detail konfigurasi & uji: [`customer-verified-login.md`](customer-verified-login.md).
2. Profil tersimpan; saldo deposit & poin loyalty diload dari CRM (`customer_crm_profiles` / settings). Profil menampilkan status email cadangan (bila fitur email aktif) dan alamat tersimpan; label sama (mis. dua "Rumah") ditampilkan dengan potongan nama jalan.
3. PWA dapat mendaftarkan **Web Push** (`/sw.js`) untuk notifikasi status order.

#### Pembuatan order

Tab **Order** berisi 3 langkah (pilihan tetap tersimpan saat maju/mundur/berpindah tab; tombol Lanjut/Pesan menempel di atas navigasi bawah):

1. **Alamat & Penjemputan** — alamat tersimpan/baru, pencarian alamat + pin peta, nomor rumah/blok, patokan → outlet terdekat yang melayani (3 cabang terdekat, tidak coming soon/overload) → *Jemput sekarang* / *Jadwalkan* → **Driver Internal** (gratis, antrean & estimasi jemput) atau **Instan** (estimasi ongkir dari jarak jalan) → catatan penjemputan.
2. **Layanan** — kiloan dan/atau satuan, durasi, kuantitas, detail cucian kiloan, voucher promo, tukar poin loyalty.
3. **Periksa & Pesan** — ringkasan yang bisa diubah per bagian, nama pemesan, rincian estimasi (subtotal, ongkir, promo, poin, total), persetujuan, satu tombol **Pesan Sekarang** (dikunci terhadap ketukan ganda; nomor order dipakai ulang saat kirim ulang).

Perhitungan harga/promo/poin/ongkir dan payload `pickup_orders` tidak berubah dibanding form satu halaman sebelumnya.

Aktivitas menampilkan **progres cucian** (jemput → outlet → sortir … siap → selesai, dari status + `work_logs`) terpisah dari **status pembayaran** (Lunas / Menunggu pembayaran / Tagihan setelah ditimbang). Detail pesanan menampilkan subtotal, diskon (dipecah menjadi diskon manual dan potongan poin bila bisa diturunkan dari `discount_type`/`discount_value`), ongkir, dan total — rumus sama dengan struk POS: `subtotal = amount + discount_amount − delivery_fee`.

Beranda → *Outlet terdekat*: bila kota diketahui/dipilih, semua cabang aktif di kota itu ditampilkan (diurutkan jarak). Kota outlet dibaca dari kolom `city`; nilai kosong/`-` jatuh ke teks alamat (mis. "Kota Bandung").
4. Pilih metode bayar:
   - **QRIS (Mayar)** → invoice + QR; tunggu webhook / tekan **Cek Status Pembayaran**.
   - **Deposit** → potong saldo (mutasi server-side saat diproses di jalur yang memakai API deposit).
5. Order masuk antrean CS / pickup.

#### Tombol “Cek Status Pembayaran”

Memanggil **`GET /api/pay/check-status`** dengan identitas order/resi. Jika Mayar sudah paid, server menjalankan jalur bayar yang sama dengan webhook (`markGatewayPaid`) agar status UI & DB konsisten.

#### Sistem Poin Loyalitas (tiering 1–5%)

Didefinisikan di `lib/crm.ts` (bisa di-override Owner di `/owner/crm`):

| Tier | Cashback poin (default) | Ambang belanja (default, jendela waktu) |
|------|-------------------------|----------------------------------------|
| Standard | **1%** | — |
| Silver | **2%** | mulai ~Rp 500.000 |
| Gold | **3%** | mulai ~Rp 1.500.000 |
| Platinum | **5%** | mulai ~Rp 3.000.000 |

- Jendela evaluasi belanja default **3 bulan** (`tier_window_months`).
- Poin dihitung dari nominal transaksi × rate tier.
- Redeem potongan (contoh default Rp 5rb / 10rb / 20rb) bisa diklaim lalu dipakai di POS/order.
- Halaman `/customer/loyalty` menampilkan tier, progres, dan skema.

---

### 2.2 Kasir POS (`/pos`)

**Entry:** `/pos` (login staf via `/login`)  
**Antrean cuci:** `/pos/queue`  
**Closing:** `/pos/closing`

#### Alur kasir (navigasi tab bawah)

POS memakai navigasi tab (bottom bar) untuk membagi pekerjaan harian, antara lain:

| Area | Fungsi tipikal |
|------|----------------|
| Order / Kasir | Input kiloan/pcs, member, QRIS, tunai, deposit |
| Antrean / Operasi | Status cucian, assign mesin (ThinQ bila aktif) |
| Setoran / Kas | Log cashflow, setoran |
| Closing | Tutup shift, selisih kas |
| Lainnya | Requisition, chat outlet, absensi terkait crew |

*(Label tab UI dapat berbeda per build; fungsi di atas adalah pemetaan operasional.)*

#### Mutasi saldo deposit

**Tidak lagi** memanggil RPC deposit langsung dari browser dengan anon key.

```
POS → POST /api/deposit/mutate
      Authorization: Bearer <PAYMENT_OPS_SECRET>
      body: { action: "credit"|"debit", phone, amount, paymentId?, staffId, role }
      → service role → credit_customer_deposit / decrement_customer_deposit
      → audit_logs (DEPOSIT_CREDIT / DEPOSIT_DEBIT)
```

- **Debit:** bayar order pakai deposit.  
- **Credit:** top-up paket member (Silver/Gold/Platinum) di POS.

#### Nota / receipt

- Layout nota dapat dikonfigurasi Owner (`receipt_layout` / Receipt Layout Editor).
- Cetak thermal / sticker mengikuti util printer di repo.
- Status bayar non-tunai yang belum verified tetap **menunggu pembayaran** (bukan auto “Diterima” palsu).

#### Pickup → POS

Saat mengubah pickup menjadi transaksi POS, sistem memakai **claim** (`claimPickupForPos`) agar satu pickup tidak menjadi dua nota (race).

#### Antrean cuci

`/pos/queue` menampilkan board operator / integrasi mesin (LG ThinQ bila diaktifkan), foto bukti tahap (deferred “Lihat foto” agar halaman ringan).

---

### 2.3 Customer Service Care (`/cs/workspace`)

**Hub 3 pintu:**

| Kartu / pintu | Rute | Fungsi |
|---------------|------|--------|
| Live Chat | `/cs` | Chat pelanggan, klaim thread, kirim invoice, macros |
| Dashboard Pickup | `/cs/dashboard` | Antrean jemput, assign driver |
| CS Care | `/cs/care` | Komplain, investigasi, tiket |

#### Unread badges

Badge / indikator unread mengikuti channel chat & notifikasi tugas (realtime Supabase + refresh periodik). Owner juga punya badge **Diagnosis** terpisah (API ringkas, bukan baca `error_logs` anon).

#### Penugasan driver (hanya ON_DUTY)

1. CS membuka antrean pickup.
2. Daftar driver yang bisa di-assign = yang **`ON_DUTY`** (clock-in aktif, belum clock-out) di outlet relevan.
3. Jika tidak ada driver on-duty → opsi kurir pihak ketiga (Gojek / Grab / Lalamove) sesuai modul 3rd-party delivery.

#### “Tandai Lunas Manual” (CS Override)

Di live chat / alur verifikasi:

1. CS membuka **Tandai Lunas Manual**.
2. Wajib identitas staf + **Bearer ops secret** + catatan / bukti bila diminta form.
3. `POST /api/pay/mark-manual` → `paid_via: MANUAL_VERIFIED` + **audit_logs**.
4. Role yang diizinkan (manual): CS, Head CS, Owner, Supervisor, Finance, Admin Ops, dll. (lihat `lib/requirePaymentOpsAuth.ts`).

---

### 2.4 Driver Portal (`/driver`)

**Entry:** `/driver` → `/driver/dashboard`

#### Clock-In / Absen multi-outlet (`ON_DUTY`)

| Aksi | Efek |
|------|------|
| **Clock-in** | Pilih outlet dari `assigned_outlet_ids` (atau fallback outlet akses) → status **`ON_DUTY`**, catat `active_outlet_id` + waktu |
| **Clock-out** | Status **`OFF_DUTY`**, tutup shift |

Tabel: `driver_attendance`.

#### Navigasi & job

- Job pickup / delivery tampil di dashboard.
- Tombol navigasi membuka **Google Maps** ke pin pelanggan.
- Upload bukti serah-terima sesuai tahap.

#### Penguncian jika libur / belum absen

- CS **tidak** menempatkan driver yang `OFF_DUTY` ke antrean jemput internal.
- Driver yang lupa clock-in tidak muncul sebagai opsi on-duty → order menunggu atau dialihkan ke 3PL.

---

### 2.5 Owner Dashboard (`/owner`)

**Entry kanonik:** `/owner`  
**`/owner/dashboard`** → redirect ke `/owner` (menghindari dua halaman berat).

#### Tab & modul utama

| Area | Isi |
|------|-----|
| P&L ringkas | Omset outlet, online/offline, expense, leaderboard |
| Approvals | Pengajuan pembelian, kasbon, kendala outlet |
| Employees | CRUD lewat `/api/owner/employees` (password di-hash) |
| Soft-void | Approve permintaan hapus → **void** (`is_void`), bukan delete baris |
| Settings | Layanan, outlet, supervisor map, receipt, COA text |
| Laporan | `/owner/reports/laba-rugi`, jurnal, buku besar, neraca, dll. |
| CRM / Promo / KPI / Performa | Modul terpisah di sidebar |
| **Diagnosis** | `/owner/system-health` |

#### Laba Rugi berbasis COA

Laporan memakai kode akun di `lib/pnlReport.ts`:

| Kelompok | Kode contoh | Contoh akun |
|----------|-------------|-------------|
| **Beban Pokok (COGS)** | **520x** | 5201 Deterjen, 5202 Gas, 5203 Parfum, 5204 Plastik, … |
| **Beban Operasional** | **600xxx** | 600003 Listrik, 600009 Gaji Crew, 600019 Sewa Ruko, 600028 MDR, … |

Pendapatan dari transaksi + membership; beban dipetakan dari kategori expense / COA yang dikonfigurasi.

#### Soft Void (pembatalan aman)

1. Kasir mengajukan hapus (`delete_requested`).
2. Owner **Setujui Void** → `softVoidTransaction`:
   - `is_void = true`
   - `status = Dibatalkan`
   - jejak nominal & resi **tetap di database**
3. Omset / KPI mengabaikan baris void (`isVoidTransaction`).
4. Di database, **DELETE** transaksi oleh role anon **dicabut** (migration money guardrails).

#### Panel Diagnosis (`/owner/system-health`)

Data lewat `GET /api/owner/system-health` (ops auth):

- `error_logs` (belum resolved)
- `webhook_logs` terkini
- Transaksi pending bayar
- Aksi **Re-sync** → `POST /api/pay/resync`
- Aksi **Tandai lunas** (modal manual) bila diperlukan

Badge di dock Owner memakai mode `?summary=1` (ringan, poll ~90 detik).

---

## 3. Daftar Peningkatan & Logika Otomatis (Improvements & Hidden Logic)

Bagagian ini menjelaskan **logika di balik layar** yang tidak selalu terlihat di UI, tetapi melindungi uang investor dan keandalan operasional.

### 3.1 Sistem keamanan pembayaran

| Mekanisme | Perilaku |
|-----------|----------|
| **Satu jalur lunas** | Webhook, cron, check-status, dan (setelah verifikasi) gateway memakai `markGatewayPaid` / mark paid idempotent |
| **`webhook_logs`** | Menyimpan jejak event gateway (status, signature_ok, error) untuk forensik |
| **`error_logs`** | Error operasional pembayaran / cron untuk diagnosis |
| **Signature / shared secret** | `MAYAR_WEBHOOK_TOKEN` / secret + opsional HMAC `PAYMENT_GATEWAY_SERVER_KEY` |
| **Service role production** | Tanpa `SUPABASE_SERVICE_ROLE_KEY`, operasi bayar server **gagal keras** di production |
| **Ops auth** | Mark manual / resync / diagnosis / deposit mutate menolak request tanpa Bearer + role sah |
| **Anti manipulasi harga** | Order API & verifikasi amount vs gateway (`amountsMatch`); client tidak boleh “memaksa” lunas tanpa jalur server |
| **POS** | Tidak ada fallback “QRIS pending → insert sebagai Diterima” |
| **RLS log** | Anon tidak bisa baca bebas `audit_logs` / tulis log sensitif |

### 3.2 Auto-reconciliation Cron (`vercel.json`)

```json
{
  "path": "/api/cron/sync-payments",
  "schedule": "*/15 * * * *"
}
```

**Cara kerja `/api/cron/sync-payments`:**

1. Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe).
2. Ambil transaksi dengan `mayar_payment_id`, belum paid, usia **5 menit – 7 hari** (max ~60 baris).
3. Resolve **API key Mayar per outlet** (cache per run), fallback env global.
4. Poll status ke Mayar; jika paid → `markGatewayPaid` + `paid_via: CRON_SYNC`.
5. Catat audit / error bila gagal.

Cron lain:

| Jadwal | Path | Fungsi |
|--------|------|--------|
| 02:30 | `/api/cron/reconcile-finance` | Rekonsiliasi keuangan |
| 03:00 | `/api/cron/crm-retention` | Retensi CRM |
| 04:00 | `/api/cron/cleanup-complaints` | Bersih tiket komplain |

### 3.3 Audit Trail (`audit_logs`)

Aktivitas sensitif dicatat (contoh aksi):

| Aksi | Contoh pemicu |
|------|----------------|
| `PAYMENT_MANUAL_VERIFIED` | CS/Owner tandai lunas manual |
| `PAYMENT_RESYNC` | Tombol Re-sync diagnosis |
| `DEPOSIT_CREDIT` / `DEPOSIT_DEBIT` | Mutasi deposit API |
| `EMPLOYEE_CREATE` / `UPDATE` / `DELETE` | CRUD karyawan Owner |

Kolom tipikal: `user_id`, `user_name`, `role`, `action`, `entity_*`, `amount`, `meta`, waktu.

**Hanya service role** yang menulis/membaca penuh; UI diagnosis tidak mengekspos audit mentah ke publik.

### 3.4 Deposit atomic & idempotensi

- RPC `credit_customer_deposit` / `decrement_customer_deposit` memakai kunci `payment_id` (`deposit_payment_credits`) agar top-up tidak dobel.
- Setelah hardening: **execute RPC hanya `service_role`**; client wajib lewat `/api/deposit/mutate`.

### 3.5 Soft-void & jejak investor

- Hard-delete nota diganti soft-void.
- Finance filter void agar omset tidak “menghilang diam-diam” tanpa jejak.

### 3.6 Login & password staf

- `/api/auth/staff-login` memverifikasi password di server.
- Format baru: `scrypt$salt$hash`.
- Plaintext legacy di-**upgrade otomatis** saat login sukses.
- Kolom `password` **tidak di-grant** ke anon (migration employees password).

### 3.7 Performa halaman Owner / bukti foto

- Finance: window **±1 tahun**, limit ~3000 transaksi.
- Foto bukti: **deferred** (tombol Lihat), tidak auto-download semua thumbnail.
- Badge diagnosis: poll ringan, bukan subscribe berat ke `error_logs` via anon.

### 3.8 Handling PWA, notifikasi & “offline”

| Aspek | Realitas di LM |
|-------|----------------|
| **Manifest** | `manifest.json` / `app/manifest.ts` — installable, start URL customer dashboard |
| **Service Worker** | `/sw.js` — terutama **Web Push** + pass-through fetch |
| **Offline-first cache** | **Belum** ada cache aplikasi penuh (POS tidak menjamin kerja total tanpa jaringan) |
| **Order “Offline” di POS** | Artinya tipe order datang langsung ke outlet, **bukan** mode offline jaringan |
| **Ketahanan praktis** | Setelah reconnect: cron + check-status + resync memperbaiki pembayaran gantung; Realtime menyambung ulang chat/antrean |

### 3.9 Owner tunggal (anti duplikasi)

- `/owner/dashboard` hanya **redirect** ke `/owner`.
- Tab **Approvals** digabung di halaman owner kanonik agar bundle & data fetch tidak dobel.

---

## 4. Panduan Troubleshooting & FAQ (Cara Solving Mandiri)

### 4.1 Webhook Payment Gateway gagal / transaksi stuck pending

**Gejala:** Pelanggan sudah bayar di Mayar, status di LM masih menunggu.

**Langkah mandiri (urut):**

1. Minta pelanggan / kasir tekan **Cek Status Pembayaran** (memanggil check-status).
2. Owner buka **`/owner/system-health`**:
   - Cek kartu **Webhook**: `signature_ok`, `error_message`, waktu event.
   - Cek daftar **Pending**.
3. Tekan **Re-sync** pada transaksi terkait.
4. Jika Mayar jelas paid tapi tetap gagal → **Tandai Lunas Manual** dengan bukti transfer/screenshot + catatan (hanya role berwenang).
5. Pastikan di dashboard Mayar URL webhook =  
   `https://<domain-anda>/api/webhooks/mayar`  
   dan secret cocok dengan env.
6. Pastikan cron hidup: tiap 15 menit seharusnya mengejar pending (uji dengan curl + `CRON_SECRET`).
7. Cek env production: `SUPABASE_SERVICE_ROLE_KEY`, `MAYAR_*`, `CRON_SECRET`.

**Jangan:** menghapus baris transaksi dari Table Editor / SQL sembarangan.

### 4.2 Cara membaca `/owner/system-health` & Re-sync

| Panel | Artinya |
|-------|---------|
| **Errors** | Kegagalan tersimpan (`source`, `message`, `hint`, `transaction_id`) |
| **Webhooks** | Jejak panggilan gateway; perhatikan `signature_ok = false` (secret salah / payload ditolak) |
| **Pending** | Order masih terkunci menunggu bayar |

**Re-sync:**

1. Pastikan Anda login sebagai Owner/Finance/Admin Ops.
2. Env `NEXT_PUBLIC_PAYMENT_OPS_SECRET` = `PAYMENT_OPS_SECRET`.
3. Klik Re-sync → server memanggil Mayar lagi → update DB bila sudah paid.
4. Jika respons `still_pending`, uang belum settle di gateway — cek app Mayar / minta bayar ulang.

### 4.3 Lokasi Google Maps / pin pelanggan tidak presisi

**Penyebab umum:** GPS HP tidak akurat, pin digeser kasar, atau hasil Nominatim kurang spesifik.

**Solusi:**

1. Di form alamat pelanggan: aktifkan GPS ulang, **geser pin** tepat di pintu rumah.
2. Lengkapi **nomor rumah / patokan** di field teks (penting untuk driver).
3. Kasir/CS dapat mengoreksi alamat di order sebelum dispatch.
4. Driver memakai tombol **navigasi Google Maps**; jika pin salah, hubungi pelanggan via chat/WA dan update koordinat di sistem bila ada form edit.
5. Rating Google outlet (Places) terpisah dari pin pelanggan — masalah rating ≠ masalah jemput.

### 4.4 Driver lupa clock-out / tidak muncul di assign CS

| Masalah | Solusi |
|---------|--------|
| Lupa **clock-in** | Driver buka `/driver` → Clock-in pilih outlet tugas |
| Lupa **clock-out** | Clock-out di panel absensi; shift lama `ON_DUTY` bisa mengunci logika outlet aktif |
| Tidak bisa di-assign | Pastikan status `ON_DUTY`, outlet sesuai `assigned_outlet_ids`, dan belum clock-out |
| Semua driver libur | CS pakai kurir 3rd-party atau tunda jemput |

Owner dapat mengecek data `driver_attendance` / laporan absensi bila perlu investigasi.

### 4.5 Deposit gagal dipotong / ditop-up di POS

1. Pastikan `PAYMENT_OPS_SECRET` terpasang di server **dan** `NEXT_PUBLIC_PAYMENT_OPS_SECRET` di client (nilai sama).
2. Pastikan migration **money_guardrails** sudah dijalankan (RPC anon sudah dicabut — wajib lewat API).
3. Cek `audit_logs` untuk `DEPOSIT_*` atau error di system-health.
4. Jangan credit deposit manual langsung di Table Editor tanpa `payment_id` (risiko double top-up).

### 4.6 Tidak bisa login staf / password

1. Login harus lewat halaman `/login` → API staff-login (bukan query password di console).
2. Setelah migration password column: client **tidak** bisa baca hash password.
3. Jika lupa password: Owner reset lewat **Employees** (isi password baru → tersimpan sebagai scrypt).
4. Pastikan `SUPABASE_SERVICE_ROLE_KEY` ada di server (login API memerlukannya).

### 4.7 Halaman Owner berat / lambat

1. Gunakan filter periode (bulan ini), jangan `ALL` tanpa perlu.
2. Buka foto bukti hanya saat diperlukan (tombol Lihat).
3. Jangan buka `/owner` dan duplikat lama secara bersamaan (dashboard sudah redirect).
4. Pastikan tidak memuat data all-time unbounded di custom query.

### 4.8 FAQ singkat

**Q: Apakah void menghapus omset dari database?**  
A: Tidak. Baris tetap ada dengan `is_void`; laporan mengabaikannya.

**Q: Bisakah kasir menandai QRIS lunas tanpa bukti?**  
A: Hanya role yang diizinkan + ops secret; setiap override masuk audit.

**Q: Apa bedanya order Offline vs Online di POS?**  
A: Offline = datang ke outlet; Online = jemput/antar. Bukan synonym “tanpa internet”.

**Q: Di mana dokumen keamanan harian?**  
A: `docs/SECURITY_AND_MAINTENANCE.md` (env, SQL, checklist fraud mingguan).

---

## 5. Lampiran teknis singkat

### 5.1 Endpoint kritis

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/staff-login` | Publik (rate-limit disarankan di edge) |
| POST | `/api/webhooks/mayar` | Webhook secret / signature |
| GET | `/api/pay/check-status` | Sesuai implementasi route (ops/order context) |
| POST | `/api/pay/mark-manual` | Bearer ops + role manual |
| POST | `/api/pay/resync` | Bearer ops + role resync |
| POST | `/api/deposit/mutate` | Bearer ops + role manual (termasuk kasir) |
| GET | `/api/cron/sync-payments` | Bearer `CRON_SECRET` |
| GET | `/api/owner/system-health` | Bearer ops + role resync |
| GET/POST | `/api/owner/employees` | Bearer ops + role resync |

### 5.2 Migrasi SQL wajib (urut)

1. Payment flags / Mayar / atomic deposit (eksisting)  
2. `20260908_payment_security_logs.sql`  
3. `20260910_harden_payment_logs_rls.sql`  
4. `20260910_money_guardrails.sql`  
5. `20260910_employees_password_rls.sql`  

### 5.3 Env production (checklist)

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
PAYMENT_OPS_SECRET=
NEXT_PUBLIC_PAYMENT_OPS_SECRET=   # sama dengan PAYMENT_OPS_SECRET
MAYAR_API_KEY=
MAYAR_WEBHOOK_TOKEN=              # atau MAYAR_WEBHOOK_SECRET
PAYMENT_GATEWAY_SERVER_KEY=       # opsional
GOOGLE_PLACES_API_KEY=            # opsional, rating outlet
```

### 5.4 Glosarium

| Istilah | Arti |
|---------|------|
| Soft-void | Transaksi dibatalkan secara logis tanpa hapus baris |
| `paid_via` | Jejak sumber pelunasan: GATEWAY / MANUAL_VERIFIED / CHECK_STATUS / CRON_SYNC |
| ON_DUTY | Driver sedang absen masuk dan siap di-assign |
| COGS 520x | Beban pokok penjualan |
| OPEX 600xxx | Beban operasional |
| Idempotent | Menjalankan ulang event paid tidak menambah saldo dobel |

---

## Penutup

Manual ini menggambarkan **cara pakai** dan **cara kerja tersembunyi** Laundrivery LM agar Owner/Investor memahami bahwa:

1. Uang dilindungi oleh **server-side payment paths**, **audit**, **cron catch-up**, dan **soft-void**.  
2. Operasional harian terbagi jelas: Customer → CS → Driver/POS → Owner.  
3. Diagnosis mandiri dimulai dari **`/owner/system-health`**, bukan mengedit database mentah.

Untuk prosedur keamanan harian, rotasi secret, dan roadmap RLS penuh, selalu ikuti **[SECURITY_AND_MAINTENANCE.md](./SECURITY_AND_MAINTENANCE.md)**.

— Tim dokumentasi LM  
