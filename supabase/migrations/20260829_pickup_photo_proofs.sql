-- Bukti foto wajib kurir: jemput di outlet + serah terima ke pelanggan.
alter table pickup_orders
  add column if not exists photo_url text,
  add column if not exists photo_outlet_url text,
  add column if not exists photo_delivery_url text;

alter table work_logs
  add column if not exists photo_url text;
