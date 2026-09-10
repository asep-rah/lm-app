# Cron rekonsiliasi pembayaran

## Batasan Vercel Hobby

Akun **Hobby** hanya mengizinkan cron **sekali per hari** per job.  
Karena itu `vercel.json` memakai jadwal harian untuk `/api/cron/sync-payments` (`10 1 * * *` UTC).

Untuk catch-up pembayaran tiap **15 menit** (disarankan production):

1. Pakai layanan cron eksternal (cron-job.org / EasyCron / GitHub Actions), **atau**
2. Upgrade Vercel ke **Pro**, lalu kembalikan schedule ke `*/15 * * * *`.

### Contoh hit eksternal tiap 15 menit

```bash
curl -H "Authorization: Bearer ISI_CRON_SECRET" \
  "https://lm-coral.vercel.app/api/cron/sync-payments"
```

## Setup Vercel
1. Project → Settings → Environment Variables
2. Tambah `CRON_SECRET` (string rahasia panjang, Production + Preview)
3. Redeploy

Vercel Cron mengirim header:
`Authorization: Bearer <CRON_SECRET>`

## Uji manual
```bash
curl -H "Authorization: Bearer ISI_CRON_SECRET" \
  "https://domain-anda.vercel.app/api/cron/sync-payments"
```

Lokal (tanpa secret): buka `/api/cron/sync-payments` saat `NODE_ENV=development`.

## Env terkait pembayaran
- `MAYAR_API_KEY` (fallback; utamakan key per outlet di tabel `outlets`)
- `MAYAR_WEBHOOK_TOKEN` / `MAYAR_WEBHOOK_SECRET`
- `PAYMENT_GATEWAY_SERVER_KEY` (opsional HMAC)
- `SUPABASE_SERVICE_ROLE_KEY` (**wajib** production)
- `CRON_SECRET`
- `PAYMENT_OPS_SECRET` + `NEXT_PUBLIC_PAYMENT_OPS_SECRET` (nilai sama) — auth mark-manual / resync / diagnosis / mutasi deposit POS
- Setelah SQL `20260910_money_guardrails.sql`: deposit credit/debit hanya lewat `/api/deposit/mutate`

Lihat juga: [SECURITY_AND_MAINTENANCE.md](./SECURITY_AND_MAINTENANCE.md).
