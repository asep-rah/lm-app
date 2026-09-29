-- Index untuk query yang paling sering dipakai aplikasi.
--
-- Tabel utama (transactions, pickup_orders, customers, work_logs) dibuat di
-- dashboard, bukan lewat migrasi, dan migrasi tidak punya index untuk kolom
-- filter/urutan yang paling sering dipakai kode (dihitung dari .eq/.in/.or/
-- .order di app/, lib/, components/):
--   transactions.created_at (urutan, 35×), customers.phone (20×),
--   transactions.customer_phone (8×), pickup_orders.status (7×),
--   transactions.outlet_id (7×), work_logs.transaction_id (6×), dst.
-- Tanpa index, Postgres membaca seluruh tabel (seq scan) di setiap query itu —
-- belum terasa selama datanya kecil, makin lambat seiring pertumbuhan.
--
-- Juga dipakai filter Realtime (customer_phone / phone_number / thread_key)
-- agar tiap customer hanya menerima baris miliknya.
--
-- Aman: hanya MENAMBAH index (tidak mengubah data/perilaku). Idempotent.
-- Setiap index dilewati bila kolomnya tidak ada di skema produksi.
-- Index bernama beda yang sudah setara di produksi tidak terdeteksi otomatis;
-- cek dulu: select indexname, indexdef from pg_indexes where tablename in
--   ('transactions','pickup_orders','customers','work_logs','support_chats');
-- Rollback: drop index if exists <nama>; untuk tiap index di bawah.

create or replace function pg_temp.lm_index(idx text, tbl text, cols text[], expr text)
returns void language plpgsql as $$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = tbl and column_name = any (cols)
  ) = cardinality(cols) then
    execute format('create index if not exists %I on public.%I %s', idx, tbl, expr);
  else
    raise notice 'lewati %: kolom % tidak lengkap di %', idx, cols, tbl;
  end if;
end $$;

-- transactions: riwayat customer, daftar per outlet, pencarian nota & pembayaran
select pg_temp.lm_index('transactions_created_at_idx', 'transactions', array['created_at'], '(created_at desc)');
select pg_temp.lm_index('transactions_customer_phone_created_idx', 'transactions', array['customer_phone','created_at'], '(customer_phone, created_at desc)');
select pg_temp.lm_index('transactions_outlet_created_idx', 'transactions', array['outlet_id','created_at'], '(outlet_id, created_at desc)');
select pg_temp.lm_index('transactions_status_idx', 'transactions', array['status'], '(status)');
select pg_temp.lm_index('transactions_receipt_number_idx', 'transactions', array['receipt_number'], '(receipt_number)');
select pg_temp.lm_index('transactions_mayar_payment_id_idx', 'transactions', array['mayar_payment_id'], '(mayar_payment_id) where mayar_payment_id is not null');

-- pickup_orders: pesanan customer (dua kolom nomor), antrean per status
select pg_temp.lm_index('pickup_orders_customer_phone_idx', 'pickup_orders', array['customer_phone'], '(customer_phone)');
select pg_temp.lm_index('pickup_orders_phone_number_idx', 'pickup_orders', array['phone_number'], '(phone_number)');
select pg_temp.lm_index('pickup_orders_status_created_idx', 'pickup_orders', array['status','created_at'], '(status, created_at desc)');
select pg_temp.lm_index('pickup_orders_created_at_idx', 'pickup_orders', array['created_at'], '(created_at desc)');
select pg_temp.lm_index('pickup_orders_transaction_id_idx', 'pickup_orders', array['transaction_id'], '(transaction_id) where transaction_id is not null');
select pg_temp.lm_index('pickup_orders_order_number_idx', 'pickup_orders', array['order_number'], '(order_number)');

-- customers: login & profil dicari per nomor
select pg_temp.lm_index('customers_phone_idx', 'customers', array['phone'], '(phone)');

-- work_logs: tahapan proses per transaksi (timeline customer & POS)
select pg_temp.lm_index('work_logs_transaction_created_idx', 'work_logs', array['transaction_id','created_at'], '(transaction_id, created_at)');

-- support_chats: riwayat chat urut waktu per nomor
select pg_temp.lm_index('support_chats_phone_created_idx', 'support_chats', array['customer_phone','created_at'], '(customer_phone, created_at)');

analyze public.transactions;
analyze public.pickup_orders;
analyze public.customers;
