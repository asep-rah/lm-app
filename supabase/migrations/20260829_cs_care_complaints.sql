-- Kolom terstruktur untuk workspace CS Care (resolusi komplain pelanggan).
alter table outlet_issues
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists receipt_number text,
  add column if not exists outlet_name text,
  add column if not exists compensation_offer text,
  add column if not exists evidence_url text,
  add column if not exists resolved_at timestamptz;
