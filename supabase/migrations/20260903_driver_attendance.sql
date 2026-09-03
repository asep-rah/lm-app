-- Driver multi-outlet + absensi clock-in/out.
-- Jalankan di Supabase SQL Editor. File migrasi tidak membuat tabel sendiri.

alter table employees add column if not exists assigned_outlet_ids text[];

update employees
set assigned_outlet_ids = array[outlet_id::text]
where assigned_outlet_ids is null
  and outlet_id is not null;

create table if not exists driver_attendance (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null,
  driver_name text,
  active_outlet_id text,
  clock_in_at timestamptz default now(),
  clock_out_at timestamptz,
  status text default 'ON_DUTY',
  created_at timestamptz default now()
);

create index if not exists idx_driver_attendance_outlet_status
  on driver_attendance (active_outlet_id, status);

create index if not exists idx_driver_attendance_driver_status
  on driver_attendance (driver_id, status);

grant all on driver_attendance to anon, authenticated;

alter table driver_attendance replica identity full;

do $$
begin
  alter publication supabase_realtime add table driver_attendance;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
