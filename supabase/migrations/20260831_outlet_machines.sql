-- Owner-managed washer catalog per outlet. POS reads is_active = true.
-- Runtime ThinQ status stays on public.washers (same id when synced).

create table if not exists public.outlet_machines (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete cascade,
  machine_name text not null,
  capacity_type text not null default '15kg',
  max_payload_kg numeric not null default 7.0,
  thinq_device_id text,
  is_active boolean not null default true
);

alter table public.outlet_machines add column if not exists outlet_id uuid;
alter table public.outlet_machines add column if not exists machine_name text;
alter table public.outlet_machines add column if not exists capacity_type text default '15kg';
alter table public.outlet_machines add column if not exists max_payload_kg numeric default 7.0;
alter table public.outlet_machines add column if not exists thinq_device_id text;
alter table public.outlet_machines add column if not exists is_active boolean default true;

alter table public.washers add column if not exists capacity_type text default '15kg';
alter table public.washers add column if not exists max_payload_kg numeric default 7.0;
alter table public.washers add column if not exists is_active boolean default true;

update public.washers
set capacity_type = case when coalesce(capacity_kg, 15) >= 20 then '24kg' else '15kg' end
where capacity_type is null or capacity_type = '';

update public.washers
set max_payload_kg = case when coalesce(capacity_kg, 15) >= 20 then 10 else 7 end
where max_payload_kg is null;

update public.washers set is_active = true where is_active is null;

insert into public.outlet_machines (id, outlet_id, machine_name, capacity_type, max_payload_kg, thinq_device_id, is_active)
select
  w.id,
  w.outlet_id,
  coalesce(nullif(w.machine_name, ''), 'Mesin LG'),
  coalesce(nullif(w.capacity_type, ''), case when coalesce(w.capacity_kg, 15) >= 20 then '24kg' else '15kg' end),
  coalesce(w.max_payload_kg, case when coalesce(w.capacity_kg, 15) >= 20 then 10 else 7 end),
  w.thinq_device_id,
  coalesce(w.is_active, true)
from public.washers w
where w.outlet_id is not null
  and not exists (select 1 from public.outlet_machines m where m.id = w.id);

create index if not exists idx_outlet_machines_outlet_active
  on public.outlet_machines (outlet_id, is_active);

alter table public.outlet_machines enable row level security;

drop policy if exists "outlet machines staff all" on public.outlet_machines;
create policy "outlet machines staff all" on public.outlet_machines for all
  using (auth.role() = 'authenticated' or auth.role() = 'anon')
  with check (auth.role() = 'authenticated' or auth.role() = 'anon');

grant all on public.outlet_machines to anon, authenticated;

alter table public.outlet_machines replica identity full;

notify pgrst, 'reload schema';
