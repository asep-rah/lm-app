-- CRM loyalty: owner-configurable tiers, customer profiles, point logs.
-- Jalankan di Supabase SQL Editor. File migrasi tidak membuat tabel sendiri.

create table if not exists crm_settings (
  id integer primary key default 1,
  standard_rate numeric not null default 1,
  silver_rate numeric not null default 2,
  gold_rate numeric not null default 3,
  platinum_rate numeric not null default 5,
  silver_threshold numeric not null default 500000,
  gold_threshold numeric not null default 1500000,
  platinum_threshold numeric not null default 3000000,
  inactive_days integer not null default 21,
  retention_message text
);

insert into crm_settings (id) values (1)
on conflict (id) do nothing;

create table if not exists customer_crm_profiles (
  phone text primary key,
  name text,
  tier_level text not null default 'Standard',
  loyalty_points numeric not null default 0,
  total_spent numeric not null default 0,
  last_order_at timestamptz,
  last_retention_at timestamptz,
  perfume_pref text,
  fold_pref text,
  special_notes text,
  outlet_id text,
  created_at timestamptz default now()
);

create index if not exists idx_crm_profiles_tier on customer_crm_profiles (tier_level);
create index if not exists idx_crm_profiles_last_order on customer_crm_profiles (last_order_at);
create index if not exists idx_crm_profiles_outlet on customer_crm_profiles (outlet_id);

create table if not exists loyalty_point_logs (
  id uuid primary key default gen_random_uuid(),
  customer_phone text,
  transaction_id text,
  points numeric not null default 0,
  amount numeric not null default 0,
  rate numeric,
  tier_level text,
  kind text not null default 'earn',
  note text,
  created_at timestamptz default now()
);

create unique index if not exists loyalty_point_logs_tx_uidx
  on loyalty_point_logs (transaction_id)
  where transaction_id is not null;

create index if not exists idx_loyalty_logs_phone on loyalty_point_logs (customer_phone);
create index if not exists idx_loyalty_logs_created on loyalty_point_logs (created_at desc);

grant all on crm_settings to anon, authenticated;
grant all on customer_crm_profiles to anon, authenticated;
grant all on loyalty_point_logs to anon, authenticated;

alter table customer_crm_profiles replica identity full;
alter table loyalty_point_logs replica identity full;

do $$
begin
  alter publication supabase_realtime add table customer_crm_profiles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
