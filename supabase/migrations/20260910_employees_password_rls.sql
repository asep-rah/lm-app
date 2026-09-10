-- Karyawan: sembunyikan password dari anon/authenticated (column privilege).
-- Write password hanya service_role (API /api/owner/employees + staff-login rehash).

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
  into cols
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'employees'
    and c.column_name <> 'password';

  if cols is null or length(cols) < 2 then
    raise notice 'employees table / columns not found — skip';
    return;
  end if;

  execute 'revoke all on table public.employees from anon, authenticated';
  execute format('grant select (%s) on table public.employees to anon, authenticated', cols);
  -- Tidak grant insert/update/delete ke anon → CRUD lewat service role API.
end $$;

comment on column public.employees.password is 'scrypt$hash — hanya service_role; JANGAN select dari client.';
