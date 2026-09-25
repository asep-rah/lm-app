-- "Outlet penuh" becomes a manual switch for the owner and supervisors only.
--
-- The app no longer closes outlets automatically (it counted every order
-- that was not "Selesai", including delivered/cancelled/void ones, so an
-- outlet looked "penuh" forever once 20 old rows piled up). The switch is
-- outlets.is_overcapacity, changed only through /api/staff/outlet-capacity
-- (signed staff session, role re-read from employees = owner/supervisor,
-- audited) with the service role.
--
-- 1. The column exists (no-op when it does; existing values are kept).
-- 2. The server (service_role) may read outlets and change ONLY this column.
-- 3. The browser key (anon/authenticated) can no longer change it: a trigger
--    rejects any change of is_overcapacity by those roles and forces new
--    outlets created from the browser to start "not full". Other outlet
--    fields and the existing owner screens are untouched.
-- Idempotent. Rollback: drop trigger outlets_guard_overcapacity on
-- public.outlets; drop function public.outlets_guard_overcapacity();

alter table public.outlets add column if not exists is_overcapacity boolean default false;

grant select on table public.outlets to service_role;
grant update (is_overcapacity) on table public.outlets to service_role;

create or replace function public.outlets_guard_overcapacity()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_overcapacity := false;
    elsif new.is_overcapacity is distinct from old.is_overcapacity then
      raise exception 'Status penuh outlet hanya bisa diubah owner/supervisor lewat aplikasi.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists outlets_guard_overcapacity on public.outlets;
create trigger outlets_guard_overcapacity
  before insert or update on public.outlets
  for each row execute function public.outlets_guard_overcapacity();
