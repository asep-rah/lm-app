-- Keamanan tahap 2b: pengaturan, pengeluaran, omset member, dan kasbon hanya
-- ditulis server.
--
-- Sebelumnya siapa pun dengan kunci anon (ada di browser) bisa:
--   * mengubah app_settings (harga layanan, persen bagi hasil, saldo awal buku
--     outlet, voucher, COA);
--   * menambah / mengubah pengeluaran (expenses) → laba & kas palsu;
--   * menambah membership_logs → omset & komisi palsu;
--   * menyetujui kasbon sendiri / mengubah nominal & potongan (employee_loans).
-- Sekarang aplikasi menulis lewat:
--   * /api/owner/app-settings     (owner; tim keuangan hanya COA)
--   * /api/staff/expense          (staf login; revisi: owner / tim keuangan)
--   * /api/staff/membership-log   (staf login; harga & komisi dari paket)
--   * /api/owner/employee-loan    (owner: setujui / tolak / lunas)
-- semuanya memakai service role, memeriksa tutup buku, dan tercatat di audit_logs.
-- Pengajuan kasbon tetap dari POS, tetapi selalu berstatus 'pending'.
-- SELECT tidak berubah (laporan di browser masih membaca tabel ini).
--
-- URUTAN: deploy versi aplikasi ini DULU, baru jalankan SQL ini. Tidak
-- mengubah data. Idempotent.
-- Rollback:
--   grant insert, update on public.app_settings, public.expenses, public.membership_logs to anon, authenticated;
--   grant update on public.employee_loans to anon, authenticated;
--   drop trigger if exists employee_loans_guard_request on public.employee_loans;

grant select, update on table public.app_settings to service_role;
grant select, insert, update on table public.expenses to service_role;
grant select, insert on table public.membership_logs to service_role;
grant select, insert, update on table public.employee_loans to service_role;
grant select on table public.finance_period_locks to service_role;

revoke insert, update, delete on table public.app_settings from anon, authenticated;
revoke insert, update, delete on table public.expenses from anon, authenticated;
revoke insert, update, delete on table public.membership_logs from anon, authenticated;
revoke update, delete on table public.employee_loans from anon, authenticated;

-- Pengajuan kasbon dari browser: selalu 'pending', belum disetujui.
create or replace function public.employee_loans_guard_request()
returns trigger
language plpgsql
as $$
declare
  n jsonb := to_jsonb(new);
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if lower(coalesce(n->>'status', 'pending')) <> 'pending'
    or coalesce(n->>'approved_by', '') <> '' then
    raise exception 'Pengajuan kasbon harus berstatus pending; keputusan hanya dari owner.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_loans_guard_request on public.employee_loans;
create trigger employee_loans_guard_request before insert on public.employee_loans
  for each row execute function public.employee_loans_guard_request();

-- Cek cepat (harus kosong untuk anon/authenticated):
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public'
--    and table_name in ('app_settings', 'expenses', 'membership_logs', 'employee_loans')
--    and grantee in ('anon', 'authenticated')
--    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
--  order by 1, 2, 3;
-- (employee_loans masih punya INSERT untuk pengajuan dari POS — itu disengaja.)
