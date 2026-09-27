-- Keamanan tahap 1: tutup hak browser (anon/authenticated) yang TIDAK dipakai
-- aplikasi, kunci saldo deposit, dan tabel yang kini hanya ditulis server.
--
-- Hasil audit hak akses (owner, SQL Editor): hampir semua tabel publik bisa
-- INSERT/UPDATE/DELETE/TRUNCATE memakai kunci anon yang ada di browser.
-- Tahap ini hanya mencabut yang tidak dipakai aplikasi, jadi tidak ada layar
-- yang rusak. Tulisan POS/CS/owner lain dipindah ke server di tahap berikutnya.
--
-- 1. TRUNCATE, REFERENCES, TRIGGER dicabut dari anon/authenticated di SEMUA
--    tabel public (aplikasi tidak pernah memakainya).
-- 2. DELETE dicabut dari anon/authenticated di semua tabel public KECUALI yang
--    memang dihapus dari browser saat ini: cashflow_logs, delete_requests,
--    kpi_configs, outlets, promotions, user_push_subscriptions.
-- 3. customers.deposit_balance: browser tidak bisa lagi mengubah saldo
--    (dulu siapa pun bisa mengisi saldonya sendiri). Saldo hanya berubah lewat
--    server (/api/deposit/mutate, webhook Mayar, RPC deposit). Pelanggan baru
--    dari browser selalu mulai Rp0.
-- 4. cash_deposits: INSERT/UPDATE hanya server (/api/staff/cash-deposit,
--    /api/mayar/create-deposit-qris, webhook). Browser tetap bisa membaca
--    (panel QRIS & notifikasi realtime).
-- 5. deposit_topups: INSERT/UPDATE hanya server (sudah begitu di kode).
-- 6. customer_addresses: browser tidak bisa lagi MEMBACA alamat semua
--    pelanggan; pelanggan lewat /api/customer/addresses, CS memakai alamat di
--    pickup_orders.
--
-- URUTAN: deploy versi aplikasi ini DULU, baru jalankan SQL ini.
-- Tidak mengubah data. Idempotent.
-- Rollback per bagian ada di akhir file (komentar).

do $$
declare
  t text;
  keep_delete text[] := array['cashflow_logs', 'delete_requests', 'kpi_configs', 'outlets', 'promotions', 'user_push_subscriptions'];
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', t);
    if not (t = any (keep_delete)) then
      execute format('revoke delete on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- 3. Saldo deposit pelanggan.
create or replace function public.customers_guard_deposit_balance()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.deposit_balance := 0;
    elsif new.deposit_balance is distinct from old.deposit_balance then
      raise exception 'Saldo deposit hanya bisa diubah lewat server.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_guard_deposit_balance on public.customers;
create trigger customers_guard_deposit_balance
  before insert or update on public.customers
  for each row execute function public.customers_guard_deposit_balance();

-- 4–6.
revoke insert, update on table public.cash_deposits from anon, authenticated;
revoke insert, update on table public.deposit_topups from anon, authenticated;
revoke select on table public.customer_addresses from anon, authenticated;

notify pgrst, 'reload schema';

-- Rollback (mengembalikan keadaan lama yang tidak aman):
--   drop trigger if exists customers_guard_deposit_balance on public.customers;
--   grant insert, update on public.cash_deposits, public.deposit_topups to anon, authenticated;
--   grant select on public.customer_addresses to anon, authenticated;
--   grant delete on public.<tabel> to anon, authenticated;   -- per tabel bila perlu
