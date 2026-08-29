alter table pickup_orders
  add column if not exists transaction_id uuid;

alter table transactions
  add column if not exists sortir_photo_url text;
