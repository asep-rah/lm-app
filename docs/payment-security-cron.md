# Cron rekonsiliasi pembayaran

Jadwal ada di `vercel.json` → `GET /api/cron/sync-payments` tiap **15 menit**.

## Setup Vercel
1. Project → Settings → Environment Variables
2. Tambah `CRON_SECRET` (string rahasia panjang, Production + Preview)
3. Redeploy

Vercel Cron otomatis memanggil endpoint dengan header:
`Authorization: Bearer <CRON_SECRET>`

## Uji manual
```bash
curl -H "Authorization: Bearer ISI_CRON_SECRET" \
  "https://domain-anda.vercel.app/api/cron/sync-payments"
```

Lokal (tanpa secret): cukup buka `/api/cron/sync-payments` saat `NODE_ENV=development`.

## Env terkait pembayaran
- `MAYAR_API_KEY` (fallback; utamakan key per outlet di tabel `outlets`)
- `MAYAR_WEBHOOK_TOKEN` / `MAYAR_WEBHOOK_SECRET`
- `PAYMENT_GATEWAY_SERVER_KEY` (opsional HMAC)
- `SUPABASE_SERVICE_ROLE_KEY` (**wajib** production)
- `CRON_SECRET`
- `PAYMENT_OPS_SECRET` + `NEXT_PUBLIC_PAYMENT_OPS_SECRET` (nilai sama) — auth mark-manual / resync / diagnosis / mutasi deposit POS
- Setelah SQL `20260910_money_guardrails.sql`: deposit credit/debit hanya lewat `/api/deposit/mutate`

Lihat juga: [SECURITY_AND_MAINTENANCE.md](./SECURITY_AND_MAINTENANCE.md).
