-- Self-checkout deposit top-up via Mayar QRIS (audit trail).
-- Income for Finance/POS tetap dicatat di membership_logs agar omset tidak dobel.

create table if not exists deposit_topups (
  id uuid primary key default gen_random_uuid(),
  customer_phone text,
  customer_name text,
  outlet_id text,
  package_name text,
  amount integer,
  balance_added integer,
  bonus integer,
  status text default 'PENDING',
  payment_method text default 'QRIS Mayar',
  mayar_payment_id text,
  mayar_invoice_url text,
  receipt text,
  paid_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists deposit_topups_phone_idx on deposit_topups (customer_phone);
create index if not exists deposit_topups_payment_idx on deposit_topups (mayar_payment_id);
