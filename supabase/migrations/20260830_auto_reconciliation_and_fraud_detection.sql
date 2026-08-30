-- Daily cash/QRIS reconciliation + leakage / fraud alerts for Finance & Owner.

create table if not exists daily_reconciliations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references outlets(id) on delete set null,
  date date not null,
  system_cash_total numeric default 0,
  system_qris_total numeric default 0,
  reported_cash_deposit numeric default 0,
  gateway_qris_settlement numeric default 0,
  cash_discrepancy numeric default 0,
  qris_discrepancy numeric default 0,
  status text not null default 'UNSETTLED',
  created_at timestamptz default now(),
  constraint daily_reconciliations_status_chk
    check (status in ('MATCHED', 'DISCREPANCY_ALERT', 'UNSETTLED'))
);

create unique index if not exists daily_reconciliations_outlet_date_uidx
  on daily_reconciliations (outlet_id, date);

create index if not exists daily_reconciliations_status_idx
  on daily_reconciliations (status, date desc);

create table if not exists financial_leakage_alerts (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references outlets(id) on delete set null,
  trx_id uuid,
  alert_type text not null,
  severity text not null default 'MEDIUM',
  leakage_amount numeric default 0,
  analysis_reason text,
  is_resolved boolean default false,
  resolved_by uuid,
  created_at timestamptz default now(),
  constraint financial_leakage_alerts_type_chk
    check (alert_type in (
      'UNMATCHED_DEPOSIT',
      'OVERDUE_SETTLEMENT',
      'SUSPICIOUS_VOID',
      'EXCESSIVE_DISCOUNT',
      'WEIGHT_MISMATCH'
    )),
  constraint financial_leakage_alerts_severity_chk
    check (severity in ('MEDIUM', 'HIGH', 'CRITICAL'))
);

create index if not exists financial_leakage_alerts_open_idx
  on financial_leakage_alerts (is_resolved, severity, created_at desc);

create index if not exists financial_leakage_alerts_outlet_idx
  on financial_leakage_alerts (outlet_id, alert_type, is_resolved);

grant all on daily_reconciliations to anon, authenticated;
grant all on financial_leakage_alerts to anon, authenticated;

alter table daily_reconciliations replica identity full;
alter table financial_leakage_alerts replica identity full;

do $$
begin
  alter publication supabase_realtime add table daily_reconciliations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table financial_leakage_alerts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
