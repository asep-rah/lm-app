# Workflow n8n untuk LM App

Dua workflow yang memakai endpoint `/api/integrations/n8n/*`. Spesifikasi
endpoint-nya ada di [`../n8n-integration.md`](../n8n-integration.md).

| Berkas | Workflow | Pemicu |
|---|---|---|
| `04-lm-app-digest-approval.json` | Tarik ringkasan, terbitkan token, kirim permintaan approval | Jadwal, tiap jam |
| `05-lm-app-terima-balasan-approval.json` | Baca balasan WhatsApp, teruskan keputusan ke aplikasi | Webhook |

Alurnya sengaja dipecah dua: yang satu berjadwal, yang satu menunggu balasan.
Menggabungkannya berarti satu workflow menganggur menunggu manusia.

## Prasyarat

1. Migrasi `supabase/migrations/20260920_n8n_integration.sql` sudah dijalankan.
2. Di **Owner → Karyawan → Edit**, nomor WhatsApp supervisor/owner sudah diisi.
   Selama ini kosong, aplikasi menjawab **403** dan tidak ada pesan yang keluar.
   Itu perilaku yang benar, bukan kerusakan.
3. Di Vercel sudah ada `N8N_SHARED_SECRET`.

## Pemasangan

### 1. Credential di n8n

Buat satu credential baru, **Header Auth**:

- Nama: `LM App — n8n secret`
- Name: `authorization`
- Value: `Bearer <isi N8N_SHARED_SECRET yang sama dengan di Vercel>`

Credential Evolution API yang sudah Anda pakai di workflow lain dipakai ulang,
tidak perlu membuat baru.

### 2. Impor

n8n → **Workflows → Import from File** untuk masing-masing berkas JSON.

### 3. Isi konfigurasi

Konfigurasi sengaja dikumpulkan di **satu node Code** per workflow, bukan
disebar ke banyak node — supaya tidak ada nilai yang tertinggal belum diganti.

- Workflow 04 → node **`1. Konfigurasi`**: `baseUrl`, `approverPhone`,
  `evoInstance`, `minAgeHours`.
- Workflow 05 → node **`1. Baca Balasan`**, blok `cfg` di paling atas:
  `baseUrl`, `evoInstance`.

Keduanya berhenti dengan pesan jelas kalau `baseUrl` masih berisi teks
`GANTI-DENGAN-DOMAIN-LM-APP`, atau kalau `approverPhone` bukan format `62…`.
Lebih baik berhenti daripada menembak domain yang tidak ada lalu diam.

### 4. Pilih credential di tiap node HTTP

n8n tidak ikut membawa credential di dalam berkas impor — itu memang
disengaja, berkas ini tidak boleh memuat rahasia. Pilih manual:

| Workflow | Node | Credential |
|---|---|---|
| 04 | `2. Ambil Digest` | LM App — n8n secret |
| 04 | `5. Minta Token` | LM App — n8n secret |
| 04 | `7. Kirim WhatsApp` | Evolution API |
| 05 | `2. Kirim Keputusan ke LM App` | LM App — n8n secret |
| 05 | `4. Balas ke WhatsApp` | Evolution API |

### 5. Arahkan balasan WhatsApp ke workflow 05

Ambil URL produksi node **`Balasan WhatsApp Masuk`** (path `lm-approval-wa`),
lalu daftarkan sebagai webhook Evolution API untuk instance yang dipakai
approver, event `messages.upsert`.

**Perhatikan bentrokan.** Evolution API mengirim event masuk ke webhook yang
terdaftar untuk instance itu. Workflow `Cek Grup WhatsApp` sudah memakai path
`wa-incoming`. Kalau satu instance dipakai berdua, salah satu tidak akan
kebagian. Pilih salah satu:

- pakai instance terpisah untuk approval (paling bersih), atau
- biarkan workflow penerima yang sudah ada mem-forward ke path `lm-approval-wa`.

Node webhook ini sengaja **tidak diberi header auth**. Yang menjaganya bukan
webhook-nya, melainkan aplikasinya: kode sekali pakai, berumur 60 menit, dan
harus datang dari nomor yang persis menerimanya. Payload palsu tanpa kode yang
sah tidak menghasilkan apa pun.

## Uji sebelum diaktifkan

1. Buat satu pengajuan uji di aplikasi, biarkan berstatus `Pending Approval`.
2. Di node `1. Konfigurasi`, turunkan `minAgeHours` ke `0` sementara.
3. Workflow 04 → **Execute workflow**. WhatsApp approver harus menerima pesan
   berisi dua baris kode.
4. Balas dengan menyalin baris `SETUJU …`.
5. Workflow 05 harus jalan, approver menerima balasan konfirmasi, dan status
   pengajuan di aplikasi berpindah ke `Approved - Awaiting Admin Ops`.
6. Balas kode yang sama sekali lagi — harus ditolak dengan "Token sudah
   dipakai". Kalau berhasil dua kali, **jangan diaktifkan**, laporkan.
7. Kembalikan `minAgeHours`, aktifkan kedua workflow.

## Batas yang disengaja

**Tidak bisa menandai Paid.** Workflow ini hanya persetujuan supervisor atau
penolakan. `docs/BUSINESS_RULES.md` §18 butir 2 mengharuskan owner membayar
satu per satu sambil melihat rincian pengajuan; balasan WhatsApp tidak
memenuhi syarat itu. Pembayaran tetap di dalam aplikasi.

**Satu approver.** `approverPhone` berisi satu nomor. Mengirim satu pengajuan
ke beberapa approver sekaligus menimbulkan pertanyaan yang belum dijawab aturan
bisnis: apakah cukup satu yang menyetujui, dan siapa yang tercatat sebagai
pemutus. Biarkan begitu sampai aturannya diputuskan.

**Tidak ada percobaan ulang otomatis.** Node `4. Buang Yang Sudah Dikirim`
menandai sebuah pengajuan sudah diproses **sebelum** token diterbitkan. Kalau
pengiriman WhatsApp-nya gagal setelah itu, pengajuan tersebut tidak akan dicoba
lagi di jalankan berikutnya — setujui lewat aplikasi.

Urutan itu dipilih sadar. Kalau penandaan ditaruh setelah pengiriman, setiap
putaran jam akan menerbitkan token baru untuk pengajuan yang sama, dan setiap
token adalah kredensial approval yang hidup 60 menit. Menumpuk kredensial hidup
lebih berbahaya daripada satu pesan yang gagal terkirim.

Riwayat dedup disimpan di dalam node (`historySize: 10000`). Menghapus atau
mengganti node itu menghapus riwayatnya, dan putaran berikutnya akan mengirim
ulang seluruh antrean yang masih menunggu.
