-- Konfigurasi KPI bulanan yang diedit Top Management.
-- Satu baris = satu metrik untuk satu role pada satu bulan (YYYY-MM).

create table if not exists kpi_configs (
  id                 uuid primary key default gen_random_uuid(),
  month_year         text not null,
  role               text not null,
  metric_key         text not null,
  metric_label       text not null,
  target_value       numeric not null default 0,
  weight_percentage  numeric not null default 0,
  is_active          boolean not null default true,
  updated_by         text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists idx_kpi_configs_month on kpi_configs (month_year);
create index if not exists idx_kpi_configs_role on kpi_configs (month_year, role);

grant all on kpi_configs to anon, authenticated;
