-- POS ↔ Owner sync: jurnal kas, antrian persetujuan, dan log stok.
-- Jalankan di Supabase SQL Editor. File migrasi tidak membuat tabel sendiri.

create table if not exists cashflow_logs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid,
  type text default 'income',
  source text default 'pos',
  amount numeric default 0,
  payment_method text,
  reference_id text,
  note text,
  actor_name text,
  created_at timestamptz default now()
);

create index if not exists idx_cashflow_logs_outlet on cashflow_logs (outlet_id);
create index if not exists idx_cashflow_logs_created on cashflow_logs (created_at desc);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'purchase',
  status text not null default 'pending',
  outlet_id uuid,
  requested_by text,
  title text,
  amount numeric default 0,
  description text,
  source_table text,
  source_id text,
  created_at timestamptz default now()
);

create index if not exists idx_submissions_status on submissions (status);
create index if not exists idx_submissions_outlet on submissions (outlet_id);
create index if not exists idx_submissions_created on submissions (created_at desc);

create table if not exists inventory_logs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid,
  item_name text,
  qty numeric default 0,
  unit text,
  note text,
  actor_name text,
  created_at timestamptz default now()
);

create index if not exists idx_inventory_logs_outlet on inventory_logs (outlet_id);
create index if not exists idx_inventory_logs_created on inventory_logs (created_at desc);

alter table attendance_logs add column if not exists latitude numeric;
alter table attendance_logs add column if not exists longitude numeric;
alter table attendance_logs add column if not exists check_out_latitude numeric;
alter table attendance_logs add column if not exists check_out_longitude numeric;

grant all on cashflow_logs to anon, authenticated;
grant all on submissions to anon, authenticated;
grant all on inventory_logs to anon, authenticated;
