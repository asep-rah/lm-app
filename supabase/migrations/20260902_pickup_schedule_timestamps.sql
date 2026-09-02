-- Kolom jadwal jemput untuk order terjadwal (ISO timestamp + pecahan date/time).
-- Jalankan di Supabase SQL Editor. Migration file tidak membuat tabel live sendiri.

alter table pickup_orders add column if not exists pickup_date date;
alter table pickup_orders add column if not exists pickup_time time;
alter table pickup_orders add column if not exists scheduled_at timestamptz;
alter table pickup_orders add column if not exists pickup_at timestamptz;

notify pgrst, 'reload schema';
