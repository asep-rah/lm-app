# Integrasi n8n

Permukaan integrasi antara LM App dan n8n (yang menumpang di VPS yang sama dengan
Evolution API, Postgres, dan Redis).

## Variabel lingkungan

| Env | Dipakai untuk | Wajib |
|---|---|---|
| `N8N_SHARED_SECRET` | Bearer token untuk seluruh endpoint `/api/integrations/n8n/*` | Ya di production |
| `N8N_WEBHOOK_URL` | Tujuan kejadian keluar (aplikasi → n8n) | Opsional |
| `SUPABASE_SERVICE_ROLE_KEY` | Endpoint masuk menulis dengan service role | Ya di production |

Tanpa `N8N_SHARED_SECRET` di production, semua endpoint masuk menjawab **401** —
salah konfigurasi berarti tertutup, bukan terbuka. Di development, secret yang
kosong membuat endpoint terbuka agar workflow bisa diuji lokal.

## Endpoint masuk (n8n → aplikasi)

Semua menerima `Authorization: Bearer $N8N_SHARED_SECRET`
(atau header `x-n8n-secret`).

### `POST /api/integrations/n8n/vendor-usage`

Impor pemakaian vendor untuk penagihan.

```json
{
  "entries": [
    {
      "vendor_key": "lalamove",
      "usage_date": "2026-09-18",
      "reference": "LM-88213",
      "amount": 27000,
      "qty": 1,
      "external_id": "lalamove:88213",
      "outlet_id": null
    }
  ]
}
```

- **Idempoten** lewat indeks unik `(vendor_key, external_id)`. Kiriman ulang
  menambah `skipped`, bukan baris baru.
- Entri **tanpa `external_id` ditolak**. Impor otomatis tanpa kunci idempotensi
  adalah sumber tagihan ganda.
- Maksimal 1000 entri per kiriman.

### `POST /api/integrations/n8n/google-snapshot`

Rating & review Google Bisnis per outlet.

```json
{
  "snapshots": [
    { "outlet_id": "uuid", "rating": 4.7, "review_count": 132, "unreplied_count": 3 }
  ]
}
```

- Idempoten **satu snapshot per outlet per hari** (`snapshot_date`).
- `outlets.google_rating` / `google_review_count` ikut diperbarui sebagai nilai
  terkini; riwayatnya tetap di `outlet_google_snapshots`.

### `GET|POST /api/integrations/n8n/task-digest`

Ringkasan terjadwal: tugas terlambat, tugas segera jatuh tempo, antrean
pengajuan, dan entri vendor yang belum ditagih.

- `?hours=12` mengatur ambang "segera jatuh tempo" (1–72).
- `?emit=1` sekaligus mengirim kejadian ke `N8N_WEBHOOK_URL`.

`requisitions.pendingApproval` dan `requisitions.awaitingOwnerPayment`
**dirinci**, bukan sekadar dihitung — n8n butuh `id` pengajuan untuk meminta
token approval di langkah berikutnya:

```json
{
  "requisitions": {
    "pendingApproval": [
      { "id": "uuid", "title": "Beli deterjen", "amount": 150000, "ageHours": 26.5 }
    ],
    "awaitingAdminOpsVerification": 2,
    "awaitingOwnerPayment": [ { "id": "uuid", "title": "…", "amount": 0, "ageHours": 3 } ]
  }
}
```

Yang paling lama menunggu berada di urutan pertama. Tahap verifikasi Admin Ops
hanya dihitung: tidak ada aksi WhatsApp untuk tahap itu, jadi mengirim
rinciannya keluar hanya membocorkan angka pengeluaran tanpa manfaat.

**Jadwalkan dari n8n**, bukan dari `vercel.json`, supaya jadwal dan tujuan
pengiriman bisa diubah tanpa deploy.

## Approval lewat WhatsApp

Dua langkah, sengaja tidak satu.

### 1. `POST /api/integrations/n8n/request-approval-token`

```json
{ "requisition_id": "uuid", "phone": "081234567890" }
```

Mengembalikan token **sekali saja**:

```json
{ "ok": true, "token": "…", "expiresAt": "…", "approver": { "name": "…", "role": "supervisor" } }
```

Syarat: pengajuan masih di tahap `Pending Approval`, dan nomor terdaftar di
`employees.whatsapp` milik seseorang berperan `supervisor` atau `owner`.

**Prasyarat pemakaian.** Nomor diisi Owner lewat **Owner → Karyawan → Edit →
No. WhatsApp**; disimpan sudah dinormalkan ke `62xxx` supaya pencocokan tidak
bergantung pada cara owner mengetik. Selama belum ada nomor terdaftar,
endpoint ini selalu menjawab 403 dan alur approval WhatsApp tidak berjalan —
itu perilaku yang benar, bukan kerusakan. Kalau migrasi
`20260920_n8n_integration.sql` belum dijalankan, penyimpanan nomor gagal dengan
pesan yang menyebut migrasinya, bukan diam-diam tersimpan tanpa nomor.

### 2. `POST /api/integrations/n8n/approval-callback`

```json
{ "token": "…", "phone": "081234567890", "decision": "approve", "reason": "" }
```

`decision` menerima `approve|setuju|ya|yes|ok` dan `reject|tolak|no|tidak`.

### Pengamanan

- Token **sekali pakai**, berumur 60 menit. Bukan sekadar balas "YA".
- Yang disimpan adalah **hash** token. Isi tabel yang bocor tidak langsung bisa
  dipakai menyetujui apa pun.
- Nomor pengirim diverifikasi terhadap penerima token; token bocor tetap tidak
  bisa dipakai dari nomor lain.
- Penandaan terpakai memakai satu `UPDATE … WHERE used_at IS NULL`, jadi dua
  balasan bersamaan tidak bisa dua-duanya berhasil.
- Setiap hasil — berhasil maupun ditolak — masuk `audit_logs`.
- `approval_tokens` **tidak** diberi grant ke `anon`/`authenticated`.

### Batasan yang sengaja dipasang

Endpoint ini **hanya** melakukan persetujuan supervisor (`Pending Approval` →
`Approved - Awaiting Admin Ops`) atau penolakan. Ia **tidak bisa** menandai
`Paid`.

`docs/BUSINESS_RULES.md` §18 butir 2 mengharuskan owner membayar satu per satu
sambil melihat rincian pengajuan; balasan WhatsApp tidak memenuhi syarat itu.
Pembayaran tetap dilakukan owner di dalam aplikasi.

## Kejadian keluar (aplikasi → n8n)

`lib/n8nEvents.ts`, POST ke `N8N_WEBHOOK_URL`, amplop:

```json
{ "event": "task.overdue", "sentAt": "…", "source": "lm-app", "data": { } }
```

Nama kejadian — hanya empat, semuanya dikirim dari `task-digest?emit=1`:

| Kejadian | Isi `data` |
|---|---|
| `task.overdue` | `{ tasks: [...] }` |
| `task.due_soon` | `{ hours, tasks: [...] }` |
| `requisition.awaiting_approval` | `{ requisitions: [...] }` |
| `requisition.awaiting_owner` | `{ requisitions: [...] }` (pengingat saja) |

Tidak ada `task.created`, `supervision.submitted`, atau `complaint.created`.
Ketiganya lahir di browser (`RequisitionForm`, `VisitForm`, form komplain), dan
mengirimnya dari sana menuntut `N8N_SHARED_SECRET` diterbitkan sebagai
`NEXT_PUBLIC_` — dilarang `AGENTS.md`. Nama kejadian yang tidak pernah terkirim
lebih buruk daripada tidak ada, jadi ketiganya sengaja tidak didaftarkan.
Untuk hal-hal itu, biarkan n8n **menarik** lewat `task-digest`.

`emit=1` mengirim ulang setiap kali dipanggil selama antreannya belum kosong —
tidak ada penandaan "sudah dinotifikasi" di sisi aplikasi. **Deduplikasi di
n8n** (misalnya simpan id yang sudah dikirim), kalau tidak satu pengajuan yang
menganggur seminggu akan menghasilkan satu pesan WhatsApp per jadwal.

Sifatnya **gagal-diam**: kegagalan webhook tidak boleh membatalkan transaksi
bisnis yang sudah berhasil. Batas waktu 5 detik.

**Hanya dipanggil dari server** (route handler / cron).

## Uji terima

```bash
BASE=https://app.example.com
SECRET=$N8N_SHARED_SECRET

# 1. Tanpa secret harus 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/integrations/n8n/vendor-usage

# 2. Dengan secret harus 200
curl -s -X POST $BASE/api/integrations/n8n/vendor-usage \
  -H "authorization: Bearer $SECRET" -H 'content-type: application/json' \
  -d '{"entries":[{"vendor_key":"lalamove","usage_date":"2026-09-18","amount":27000,"external_id":"uji-1"}]}'

# 3. Payload yang sama dua kali -> inserted 0, skipped 1
```

## Catatan kapasitas

VPS 2 GB dengan n8n, Evolution API, Postgres, dan Redis berbagi tempat; swap
sudah terpakai. Workflow n8n yang berat berisiko OOM — `next build` di mesin ini
sudah pernah dibunuh OOM killer. Naikkan RAM sebelum mengandalkan otomasi ini
untuk operasional harian.
