-- Payment security: webhook audit, error diagnosis, sensitive-action audit trail
create table if not exists public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  gateway text not null default 'mayar',
  event_type text,
  external_id text,
  transaction_id uuid,
  http_status int,
  signature_ok boolean,
  amount_expected numeric,
  amount_received numeric,
  status text not null default 'RECEIVED',
  error_message text,
  raw_payload jsonb,
  headers jsonb,
  created_at timestamptz not null default now()
);

create index if not exists webhook_logs_created_idx on public.webhook_logs (created_at desc);
create index if not exists webhook_logs_tx_idx on public.webhook_logs (transaction_id);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  code text,
  message text not null,
  hint text,
  severity text not null default 'ERROR',
  context jsonb,
  transaction_id uuid,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now()
);

create index if not exists error_logs_open_idx on public.error_logs (resolved, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  user_name text,
  role text,
  action text not null,
  entity_type text,
  entity_id text,
  amount numeric,
  meta jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);

alter table public.transactions
  add column if not exists paid_via text;

comment on column public.transactions.paid_via is 'GATEWAY | MANUAL_VERIFIED | CHECK_STATUS | CRON_SYNC';
