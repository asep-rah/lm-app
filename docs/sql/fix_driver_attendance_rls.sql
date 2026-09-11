-- Fix RLS driver_attendance: izinkan absensi driver dari client (anon/authenticated).
-- Error: "new row violates row-level security policy for table driver_attendance"
-- Jalankan di Supabase SQL Editor sebagai postgres.

grant all on public.driver_attendance to anon, authenticated, service_role;

alter table public.driver_attendance enable row level security;

drop policy if exists "driver_attendance_select_all" on public.driver_attendance;
drop policy if exists "driver_attendance_insert_all" on public.driver_attendance;
drop policy if exists "driver_attendance_update_all" on public.driver_attendance;
drop policy if exists "driver_attendance_delete_all" on public.driver_attendance;
drop policy if exists "driver_attendance_all" on public.driver_attendance;

create policy "driver_attendance_select_all"
  on public.driver_attendance for select
  to anon, authenticated
  using (true);

create policy "driver_attendance_insert_all"
  on public.driver_attendance for insert
  to anon, authenticated
  with check (true);

create policy "driver_attendance_update_all"
  on public.driver_attendance for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "driver_attendance_delete_all"
  on public.driver_attendance for delete
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';
