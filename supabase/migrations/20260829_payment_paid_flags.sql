alter table transactions
  add column if not exists is_paid boolean default false,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_verified_by text;
