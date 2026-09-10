-- HOTFIX login production (sementara)
-- Gejala: username "owner" ada di Table Editor, tapi /login bilang "Username tidak ditemukan"
-- Penyebab: revoke kolom password ke anon + aplikasi Vercel masih login lama (select * dari browser).
--
-- Jalankan di Supabase SQL Editor project yang sama dengan Vercel (Laundrymanagement).
-- Setelah deploy kode baru (/api/auth/staff-login + SERVICE_ROLE_KEY), jalankan lagi
-- 20260910_employees_password_rls.sql untuk mengunci password dari anon.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
  into cols
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'employees';

  if cols is null then
    raise exception 'Tabel employees tidak ditemukan';
  end if;

  execute 'revoke all on table public.employees from anon, authenticated';
  -- Sementara: izinkan SELECT semua kolom (termasuk password) agar login lama di Vercel hidup lagi
  execute format('grant select (%s) on table public.employees to anon, authenticated', cols);

  raise notice 'HOTFIX OK: anon/authenticated bisa SELECT employees lagi (termasuk password). Segera deploy staff-login lalu kunci ulang.';
end $$;

-- Verifikasi cepat (harus 1 baris):
-- select username, role from employees where username ilike 'owner';
