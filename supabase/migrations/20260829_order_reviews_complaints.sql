-- Ulasan pelanggan + status komplain 24 jam setelah serah terima.

create table if not exists order_reviews (
  id               uuid primary key default gen_random_uuid(),
  transaction_id   uuid,
  pickup_id        uuid,
  outlet_id        uuid,
  customer_id      uuid,
  customer_phone   text,
  rating           integer not null,
  comment          text,
  created_at       timestamptz default now()
);

create index if not exists idx_order_reviews_outlet on order_reviews (outlet_id, created_at desc);
create index if not exists idx_order_reviews_tx on order_reviews (transaction_id);

alter table transactions
  add column if not exists complaint_status text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table pickup_orders
  add column if not exists complaint_status text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table outlet_issues
  add column if not exists transaction_id uuid,
  add column if not exists pickup_id uuid,
  add column if not exists assigned_to_role text,
  add column if not exists priority text;

grant all on order_reviews to anon, authenticated;
