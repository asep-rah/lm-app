# Verifikasi setelah reset + CSV layanan

Jalankan setelah backup + eksekusi [`reset_keep_sorcha_dago.sql`](./reset_keep_sorcha_dago.sql) di Supabase SQL Editor (postgres/service role).

## 1) Outlet

```sql
SELECT count(*) AS outlet_count FROM outlets;  -- expect 1
SELECT id, name FROM outlets;                 -- Sorcha Dago
```

## 2) Histori operasional kosong

```sql
SELECT
  (SELECT count(*) FROM transactions) AS txs,
  (SELECT count(*) FROM work_logs) AS work_logs,
  (SELECT count(*) FROM pickup_orders) AS pickups,
  (SELECT count(*) FROM expenses) AS expenses,
  (SELECT count(*) FROM membership_logs) AS memberships;
```

Semua count diharapkan `0` (tabel yang belum ada di DB boleh diabaikan).

## 3) Sample layanan (katalog global tetap)

```sql
SELECT
  CASE
    WHEN jsonb_typeof(to_jsonb(dynamic_services)) = 'string'
      THEN jsonb_array_length((dynamic_services #>> '{}')::jsonb)
    WHEN jsonb_typeof(to_jsonb(dynamic_services)) = 'array'
      THEN jsonb_array_length(to_jsonb(dynamic_services))
    ELSE NULL
  END AS service_count
FROM app_settings
WHERE id = 1;
```

Sample nama (10 baris):

```sql
SELECT elem ->> 'name' AS service_name
FROM app_settings,
LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(to_jsonb(dynamic_services)) = 'string'
      THEN (dynamic_services #>> '{}')::jsonb
    ELSE to_jsonb(dynamic_services)
  END
) AS elem
WHERE id = 1
LIMIT 10;
```

## 4) UI CSV + POS

1. Owner → Settings → Dynamic Services (**GLOBAL**): **Export CSV** → edit di Sheets → **Import CSV** → **SIMPAN SEMUA PENGATURAN**.
2. Buka POS outlet Sorcha Dago: daftar layanan sesuai import; buat 1 order uji.
3. Pastikan selector outlet hanya menampilkan Sorcha Dago.
