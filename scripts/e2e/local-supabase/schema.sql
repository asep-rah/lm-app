-- LOCAL TEST DATABASE ONLY (Supabase CLI stack on 127.0.0.1). Never run this
-- against staging/production: it DROPS and recreates the tables below.
--
-- Approximates the production tables the customer order flow, POS and CS
-- dashboard touch, built from the columns used in code and the repo
-- migrations. The production-only constraint that caused the reported bug
-- (pickup_orders.pickup_date NOT NULL, added outside Git) is reproduced here.
-- Grants mirror production today: operational tables are writable by anon;
-- error_logs/audit_logs are service-role only (20260910_harden_payment_logs_rls).

drop table if exists pickup_orders, system_tasks, outlets, transactions, app_settings, customers,
  customer_addresses, employees, error_logs, audit_logs, driver_attendance cascade;

create table outlets (
  id uuid primary key,
  name text, city text, address_detail text, whatsapp_number text,
  latitude numeric, longitude numeric,
  is_coming_soon boolean default false, is_overcapacity boolean default false
);

create table customer_addresses (
  id uuid primary key default gen_random_uuid(), customer_phone text, label_name text,
  full_address text, is_primary boolean, latitude numeric, longitude numeric, created_at timestamptz default now()
);

create table pickup_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  outlet_id uuid references outlets(id),
  customer_name text,
  customer_phone text,
  phone_number text,
  service_type text,
  estimated_weight numeric,
  address text,
  formatted_address text,
  latitude numeric,
  longitude numeric,
  address_id uuid references customer_addresses(id),
  duration text default 'Reguler (3 Hari)',
  bag_count integer default 1,
  wash_process text default 'Pisah',
  has_fading boolean default false,
  has_valuables boolean default false,
  items jsonb default '[]'::jsonb,
  delivery_fee numeric,
  notes text,
  status text,
  courier_type text,
  driver_id uuid,
  driver_name text,
  accepted_at timestamptz,
  transaction_id text,
  pickup_date date not null,
  pickup_time time,
  scheduled_at timestamptz,
  pickup_at timestamptz,
  photo_pickup_url text,
  photo_outlet_url text,
  created_at timestamptz default now()
);

create table system_tasks (
  id uuid primary key default gen_random_uuid(),
  title text, description text, assigned_to_role text, sla_hours numeric,
  due_date timestamptz, kpi_penalty_points numeric, status text,
  source_type text, source_id text, created_at timestamptz default now()
);

create table transactions (
  id uuid primary key, receipt_number text, customer_phone text, outlet_id uuid references outlets(id),
  status text, is_paid boolean, payment_status text, amount numeric,
  discount_type text, discount_value numeric, discount_amount numeric, delivery_fee numeric,
  duration text, service_type text, items jsonb, created_at timestamptz default now()
);

create table app_settings (
  id int primary key, dynamic_services text, outlet_overrides text, receipt_terms text, promos_data text
);

create table customers (phone text primary key, name text, deposit_balance numeric default 0);

create table employees (
  id uuid primary key default gen_random_uuid(), name text, role text, outlet_id uuid,
  username text, password text, access_outlets jsonb, assigned_outlet_ids jsonb, basic_salary numeric
);

create table driver_attendance (
  id uuid primary key default gen_random_uuid(), driver_id uuid, driver_name text, active_outlet_id uuid,
  clock_in_at timestamptz, clock_out_at timestamptz, status text, created_at timestamptz default now()
);

create table error_logs (
  id uuid primary key default gen_random_uuid(), source text, code text, message text, hint text,
  severity text, context jsonb, transaction_id text, created_at timestamptz default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(), user_id text, user_name text, role text, action text,
  entity_type text, entity_id text, amount numeric, meta jsonb, ip_address text, created_at timestamptz default now()
);

grant all on outlets, pickup_orders, system_tasks, transactions, app_settings, customers,
  customer_addresses, employees, driver_attendance to anon, authenticated, service_role;
revoke select (password), update (password), insert (password) on employees from anon, authenticated;
grant all on error_logs, audit_logs to service_role;
alter table error_logs enable row level security;
alter table audit_logs enable row level security;

notify pgrst, 'reload schema';
