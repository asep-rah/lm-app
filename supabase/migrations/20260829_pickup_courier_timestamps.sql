-- Stempel waktu alur kurir. Kolom lama (created_at, status, photo_*) tetap.
-- Insert aplikasi memakai helper yang membuang kolom ini bila Postgres menolak.

alter table pickup_orders
  add column if not exists driver_name text,
  add column if not exists accepted_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists arrived_outlet_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists driver_lat double precision,
  add column if not exists driver_lon double precision;

create index if not exists idx_pickup_orders_driver_status
  on pickup_orders (status);
