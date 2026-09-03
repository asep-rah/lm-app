-- Pinpoint pickup: simpan koordinat presisi di alamat pelanggan dan order jemput.
-- Jalankan di Supabase SQL Editor. File migrasi tidak membuat tabel sendiri.

alter table customer_addresses add column if not exists latitude numeric;
alter table customer_addresses add column if not exists longitude numeric;

alter table pickup_orders add column if not exists latitude numeric;
alter table pickup_orders add column if not exists longitude numeric;
alter table pickup_orders add column if not exists formatted_address text;

notify pgrst, 'reload schema';
