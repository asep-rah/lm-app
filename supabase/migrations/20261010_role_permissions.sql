-- Hak akses per role yang diatur owner (menu yang boleh dipantau dan aksi yang
-- boleh disetujui/diubah). Satu baris per role; role yang belum punya baris
-- memakai default di lib/accessControl.ts. Owner tidak disimpan (selalu penuh).
--
-- Hanya server (service role, /api/owner/role-permissions, khusus owner) yang
-- menulis. Browser boleh membaca (menu & tombol mengikuti hak), tetapi setiap
-- aksi tetap diperiksa ulang di server.
--
-- Boleh dijalankan sebelum atau sesudah deploy: tanpa tabel ini aplikasi
-- memakai default. Idempotent. Tidak mengubah data lain.
-- Rollback: drop table if exists public.role_permissions;

create table if not exists public.role_permissions (
  role text primary key,
  permissions jsonb not null default '[]'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint role_permissions_not_owner check (lower(role) <> 'owner'),
  constraint role_permissions_is_array check (jsonb_typeof(permissions) = 'array')
);

alter table public.role_permissions enable row level security;

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions
  for select to anon, authenticated using (true);

revoke all on table public.role_permissions from anon, authenticated;
grant select on table public.role_permissions to anon, authenticated;
grant select, insert, update, delete on table public.role_permissions to service_role;
