-- Jendela tier loyalty, redeem poin, dan program voucher (terpisah dari banner).
-- Jalankan di Supabase SQL Editor.

alter table crm_settings add column if not exists tier_window_months integer not null default 3;
alter table crm_settings add column if not exists redeem_amounts jsonb not null default '[5000,10000,20000]'::jsonb;

alter table customer_crm_profiles add column if not exists window_spent numeric not null default 0;
alter table customer_crm_profiles add column if not exists tier_window_started_at timestamptz;
alter table customer_crm_profiles add column if not exists pending_loyalty_discount numeric not null default 0;

create table if not exists voucher_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  program_start date,
  program_end date,
  outlet_id text,
  benefit_type text not null default 'nominal',
  benefit_value numeric not null default 0,
  distribution text not null default 'manual',
  quantity integer not null default 1,
  redeem_start date,
  redeem_end date,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists voucher_codes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid,
  code text unique,
  customer_phone text,
  status text not null default 'available',
  claimed_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_voucher_codes_program on voucher_codes (program_id);
create index if not exists idx_voucher_codes_status on voucher_codes (status);

grant all on voucher_programs to anon, authenticated;
grant all on voucher_codes to anon, authenticated;

alter table public.app_settings
  add column if not exists voucher_programs jsonb default '{"programs":[],"codes":{}}'::jsonb;

notify pgrst, 'reload schema';
