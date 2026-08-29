-- Structured third-party delivery (GoSend / GrabExpress / Lalamove).

alter table transactions
  add column if not exists courier_type text,
  add column if not exists courier_vendor text,
  add column if not exists driver_name_and_plate text,
  add column if not exists tracking_url text,
  add column if not exists handover_photo_url text;

alter table pickup_orders
  add column if not exists courier_type text,
  add column if not exists courier_vendor text,
  add column if not exists driver_name_and_plate text,
  add column if not exists tracking_url text,
  add column if not exists third_party_tracking_url text,
  add column if not exists handover_photo_url text;

create table if not exists third_party_deliveries (
  id uuid primary key default gen_random_uuid(),
  transaction_id text,
  pickup_order_id text,
  customer_phone text,
  receipt_number text,
  courier_vendor text,
  driver_name_and_plate text,
  tracking_url text,
  handover_photo_url text,
  status text not null default 'dispatched',
  created_at timestamptz default now(),
  received_at timestamptz
);

create index if not exists third_party_deliveries_tx_idx on third_party_deliveries (transaction_id);
create index if not exists third_party_deliveries_phone_idx on third_party_deliveries (customer_phone);

grant all on third_party_deliveries to anon, authenticated, service_role;

alter table third_party_deliveries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'third_party_deliveries' and policyname = 'third_party_deliveries_all'
  ) then
    create policy third_party_deliveries_all on third_party_deliveries for all using (true) with check (true);
  end if;
end $$;

alter table third_party_deliveries replica identity full;

do $$
begin
  alter publication supabase_realtime add table third_party_deliveries;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
