-- Multi-address for customer app + promo code on owner banners.
-- Run this in Supabase SQL Editor. Migration files do not create live tables by themselves.

create table if not exists customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  label_name text,
  full_address text,
  is_primary boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_customer_addresses_phone
  on customer_addresses (customer_phone);

alter table promotions add column if not exists promo_code text;
alter table pickup_orders add column if not exists address_id uuid;

grant all on customer_addresses to anon, authenticated;
alter table customer_addresses replica identity full;

do $$
begin
  alter publication supabase_realtime add table customer_addresses;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
