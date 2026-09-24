-- AUDIT READ-ONLY: data uji dari Preview PR #5 yang mungkin masuk ke PRODUKSI.
--
-- Latar: sampai commit 7f7ca19, dashboard customer/POS/CS/driver memakai URL
-- Supabase produksi yang di-hardcode, jadi deployment Preview membaca & menulis
-- database produksi. Skrip ini HANYA membaca: seluruhnya berjalan di transaksi
-- read-only (Postgres menolak INSERT/UPDATE/DELETE) dan diakhiri ROLLBACK.
-- Tidak menghapus / mengubah data pelanggan. Tindak lanjut ada di
-- docs/SECURITY_AND_MAINTENANCE.md §2b dan butuh persetujuan pemilik.
--
-- Jendela waktu: commit pertama PR #5 = 2026-09-23 21:18 UTC. Bila Preview
-- sudah dipakai sebelum itu, mundurkan nilai audit.since di bawah.

begin transaction read only;

-- 0. Parameter jendela waktu (ubah di sini). SET LOCAL diizinkan di transaksi read-only.
set local audit.since = '2026-09-23 21:00:00+00';

-- 1. KEYAKINAN TINGGI — field yang HANYA ditulis kode PR #5 (fa9b246+):
--    items[].bag_category_counts atau items[].pieces[].photo_path.
select p.id, p.order_number, p.created_at, p.status, p.customer_name, p.customer_phone, p.outlet_id,
       p.pickup_date, p.pickup_time,
       jsonb_path_exists(p.items::jsonb, '$[*].bag_category_counts ? (@ != null)') as has_bag_detail,
       jsonb_path_exists(p.items::jsonb, '$[*].pieces[*].photo_path ? (@ != null)') as has_photo_path
from pickup_orders p
where p.created_at >= current_setting('audit.since')::timestamptz
  and (jsonb_path_exists(p.items::jsonb, '$[*].bag_category_counts ? (@ != null)')
    or jsonb_path_exists(p.items::jsonb, '$[*].pieces[*].photo_path ? (@ != null)'))
order by p.created_at;

-- 2. KEYAKINAN SEDANG-TINGGI — pesanan instan yang berhasil tersimpan dengan
--    pickup_date terisi dan tanpa jam/jadwal. Kode main mengirim pickup_date
--    NULL untuk "Jemput sekarang" dan request antar, sehingga di produksi
--    (NOT NULL) insert itu gagal; baris seperti ini praktis berasal dari PR #5.
select p.id, p.order_number, p.created_at, p.status, p.customer_name, p.customer_phone, p.outlet_id,
       p.pickup_date, p.notes like 'Request Pengantaran Customer%' as is_delivery_request
from pickup_orders p
where p.created_at >= current_setting('audit.since')::timestamptz
  and p.pickup_date is not null
  and p.pickup_time is null
  and p.scheduled_at is null
  and p.pickup_at is null
  and p.status not ilike '%jadwal%'
order by p.created_at;

-- 3. SEMUA pesanan di jendela, per nomor HP — untuk mengenali nomor penguji
--    (mis. nomor pemilik/staf) vs pelanggan sungguhan. Tidak ada yang dihapus.
select p.customer_phone, count(*) as orders, min(p.created_at) as first_at, max(p.created_at) as last_at,
       array_agg(distinct p.status) as statuses
from pickup_orders p
where p.created_at >= current_setting('audit.since')::timestamptz
group by p.customer_phone
order by orders desc;

-- 4. Tugas sistem (driver/CS) yang dibuat untuk pesanan kandidat di (1)/(2).
with suspects as (
  select p.id::text as id from pickup_orders p
  where p.created_at >= current_setting('audit.since')::timestamptz
    and (jsonb_path_exists(p.items::jsonb, '$[*].bag_category_counts ? (@ != null)')
      or jsonb_path_exists(p.items::jsonb, '$[*].pieces[*].photo_path ? (@ != null)')
      or (p.pickup_date is not null and p.pickup_time is null and p.scheduled_at is null
          and p.pickup_at is null and p.status not ilike '%jadwal%'))
)
select t.id, t.created_at, t.assigned_to_role, t.status, t.title, t.source_id
from system_tasks t
where t.source_id::text in (select id from suspects)
order by t.created_at;

-- 5. Apakah pesanan kandidat sudah dikonversi jadi transaksi / pembayaran?
--    (dampak keuangan — jangan diubah tanpa proses void yang sudah ada)
with suspects as (
  select p.id::text as id, p.transaction_id::text as tx from pickup_orders p
  where p.created_at >= current_setting('audit.since')::timestamptz
    and (jsonb_path_exists(p.items::jsonb, '$[*].bag_category_counts ? (@ != null)')
      or jsonb_path_exists(p.items::jsonb, '$[*].pieces[*].photo_path ? (@ != null)')
      or (p.pickup_date is not null and p.pickup_time is null and p.scheduled_at is null
          and p.pickup_at is null and p.status not ilike '%jadwal%'))
)
select tr.id, tr.receipt_number, tr.created_at, tr.status, tr.amount, tr.payment_status
from transactions tr
where tr.pickup_id::text in (select id from suspects)
   or tr.id::text in (select tx from suspects where tx is not null)
order by tr.created_at;

-- 6. error_logs dari form pesanan customer (endpoint baru di PR #5). Versi
--    fa9b246 menyimpan SELURUH payload (nama, HP, alamat) di context.payload —
--    kolom has_payload menandai baris yang berisi data pribadi.
select e.id, e.created_at, e.code, (e.context ? 'payload') as has_payload
from error_logs e
where e.source = 'customer_order_form'
order by e.created_at;

-- 7. Artefak PR #5 lain di produksi (hanya ada bila migrasinya pernah dijalankan).
select to_regclass('public.customer_login_challenges') as login_challenges_table,
       to_regclass('public.customer_auth_identities') as auth_identities_table;
select id, public from storage.buckets where id = 'satuan-item-photos';
select count(*) as photo_objects, min(created_at) as first_at, max(created_at) as last_at
from storage.objects where bucket_id = 'satuan-item-photos';
select policyname from pg_policies
where schemaname = 'storage' and policyname in ('satuan_item_photos_write', 'satuan_item_photos_read');

rollback;
