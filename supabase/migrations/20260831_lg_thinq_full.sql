-- LG ThinQ washers (24kg / 15kg), cycle logs, unauthorized wash alerts.

create table if not exists public.washers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete cascade,
  machine_name text not null,
  capacity_kg numeric not null default 15,
  thinq_device_id text,
  status text not null default 'IDLE',
  current_order_id uuid,
  last_started_at timestamptz,
  tub_clean_used_on date
);

alter table public.washers add column if not exists outlet_id uuid;
alter table public.washers add column if not exists machine_name text;
alter table public.washers add column if not exists capacity_kg numeric default 15;
alter table public.washers add column if not exists thinq_device_id text;
alter table public.washers add column if not exists status text default 'IDLE';
alter table public.washers add column if not exists current_order_id uuid;
alter table public.washers add column if not exists last_started_at timestamptz;
alter table public.washers add column if not exists tub_clean_used_on date;

create table if not exists public.washer_cycle_logs (
  id uuid primary key default gen_random_uuid(),
  washer_id uuid references public.washers(id) on delete set null,
  order_id uuid,
  started_by_user_id uuid,
  cycle_type text default 'WASH',
  status text not null default 'RUNNING',
  batch_index integer default 1,
  bag_label text,
  machine_tag text,
  created_at timestamptz default now()
);

alter table public.washer_cycle_logs add column if not exists washer_id uuid;
alter table public.washer_cycle_logs add column if not exists order_id uuid;
alter table public.washer_cycle_logs add column if not exists started_by_user_id uuid;
alter table public.washer_cycle_logs add column if not exists cycle_type text default 'WASH';
alter table public.washer_cycle_logs add column if not exists status text default 'RUNNING';
alter table public.washer_cycle_logs add column if not exists batch_index integer default 1;
alter table public.washer_cycle_logs add column if not exists bag_label text;
alter table public.washer_cycle_logs add column if not exists machine_tag text;
alter table public.washer_cycle_logs add column if not exists created_at timestamptz default now();

create table if not exists public.unauthorized_wash_alerts (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete cascade,
  washer_id uuid references public.washers(id) on delete set null,
  detected_at timestamptz default now(),
  is_flagged_tub_clean boolean default false,
  notes text,
  machine_name text,
  is_resolved boolean default false
);

alter table public.unauthorized_wash_alerts add column if not exists outlet_id uuid;
alter table public.unauthorized_wash_alerts add column if not exists washer_id uuid;
alter table public.unauthorized_wash_alerts add column if not exists detected_at timestamptz default now();
alter table public.unauthorized_wash_alerts add column if not exists is_flagged_tub_clean boolean default false;
alter table public.unauthorized_wash_alerts add column if not exists notes text;
alter table public.unauthorized_wash_alerts add column if not exists machine_name text;
alter table public.unauthorized_wash_alerts add column if not exists is_resolved boolean default false;

create index if not exists idx_washers_outlet on public.washers (outlet_id, status);
create index if not exists idx_washer_cycles_order on public.washer_cycle_logs (order_id, status);
create index if not exists idx_washer_alerts_open on public.unauthorized_wash_alerts (is_resolved, detected_at desc);

alter table public.washers enable row level security;
alter table public.washer_cycle_logs enable row level security;
alter table public.unauthorized_wash_alerts enable row level security;

drop policy if exists "washers staff all" on public.washers;
create policy "washers staff all" on public.washers for all
  using (auth.role() = 'authenticated' or auth.role() = 'anon')
  with check (auth.role() = 'authenticated' or auth.role() = 'anon');

drop policy if exists "washer cycles staff all" on public.washer_cycle_logs;
create policy "washer cycles staff all" on public.washer_cycle_logs for all
  using (auth.role() = 'authenticated' or auth.role() = 'anon')
  with check (auth.role() = 'authenticated' or auth.role() = 'anon');

drop policy if exists "washer alerts staff all" on public.unauthorized_wash_alerts;
create policy "washer alerts staff all" on public.unauthorized_wash_alerts for all
  using (auth.role() = 'authenticated' or auth.role() = 'anon')
  with check (auth.role() = 'authenticated' or auth.role() = 'anon');

grant all on public.washers to anon, authenticated;
grant all on public.washer_cycle_logs to anon, authenticated;
grant all on public.unauthorized_wash_alerts to anon, authenticated;

alter table public.washers replica identity full;
alter table public.washer_cycle_logs replica identity full;
alter table public.unauthorized_wash_alerts replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.unauthorized_wash_alerts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
