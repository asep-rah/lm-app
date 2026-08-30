-- Per-batch ThinQ timestamps and split weight for washer_cycle_logs.

alter table public.washer_cycle_logs add column if not exists started_at timestamptz;
alter table public.washer_cycle_logs add column if not exists completed_at timestamptz;
alter table public.washer_cycle_logs add column if not exists duration_minutes integer;
alter table public.washer_cycle_logs add column if not exists split_weight_kg numeric;
alter table public.washer_cycle_logs add column if not exists batch_total integer;
alter table public.washer_cycle_logs add column if not exists batch_index integer default 1;

notify pgrst, 'reload schema';
