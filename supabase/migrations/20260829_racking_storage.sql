-- Penyimpanan rak wajib sebelum cucian pindah ke tab Ambil.
alter table transactions
  add column if not exists rack_location text,
  add column if not exists package_count text,
  add column if not exists rack_notes text,
  add column if not exists rack_number text;

alter table pickup_orders
  add column if not exists rack_location text,
  add column if not exists package_count text,
  add column if not exists rack_notes text;

alter table work_logs
  add column if not exists notes text;
