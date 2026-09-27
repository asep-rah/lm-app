-- Kontrol keuangan (prioritas 2):
--
-- A. expenses.paid_from — sumber dana pengeluaran: 'laci' (kas tunai belum
--    disetor, default lama), 'bank', 'clearing' (saldo Mayar), 'owner' (uang
--    pribadi owner = setoran modal). Kosong = laci (data lama tidak berubah).
-- B. finance_settlements — jenis baru 'gateway_payout' (pencairan saldo Mayar
--    ke rekening bank, sumber 'clearing') dengan kolom fee (potongan MDR/biaya
--    pencairan, dicatat sebagai 600028 Biaya MDR).
-- C. cash_closings — closing shift kasir. "Kas sistem" kini dihitung server
--    dari saldo Kas Tunai Belum Disetor (buku besar), bukan dari semua transaksi
--    tunai sepanjang masa. Hanya baris expected_source = 'ledger' yang dijurnal
--    (baris lama tidak ikut). Ditulis hanya oleh /api/staff/cash-closing.
-- D. finance_period_locks — tutup buku per outlet (owner). Setelah dikunci,
--    browser tidak bisa menambah/mengubah transaksi, pengeluaran, atau top up
--    bertanggal pada/sebelum tanggal kunci. Void tetap boleh (dibalik di bulan
--    void). Server (service_role) tidak terkena kunci.
--
-- Tidak mengubah data yang ada. Idempotent.

-- A
alter table public.expenses add column if not exists paid_from text;
do $$ begin
  alter table public.expenses add constraint expenses_paid_from_check
    check (paid_from is null or paid_from in ('laci', 'bank', 'clearing', 'owner'));
exception when duplicate_object then null; end $$;

-- B
alter table public.finance_settlements add column if not exists fee numeric(14, 2) not null default 0;
alter table public.finance_settlements drop constraint if exists finance_settlements_kind_check;
alter table public.finance_settlements add constraint finance_settlements_kind_check
  check (kind in ('profit_share', 'thr', 'gateway_payout'));
alter table public.finance_settlements drop constraint if exists finance_settlements_source_check;
alter table public.finance_settlements add constraint finance_settlements_source_check
  check (source in ('bank', 'laci', 'dana_thr', 'clearing'));
do $$ begin
  alter table public.finance_settlements add constraint finance_settlements_fee_check check (fee >= 0);
exception when duplicate_object then null; end $$;

-- C
create table if not exists public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid,
  created_at timestamptz not null default now()
);
alter table public.cash_closings add column if not exists cashier_id text;
alter table public.cash_closings add column if not exists system_expected_cash numeric;
alter table public.cash_closings add column if not exists physical_actual_cash numeric;
alter table public.cash_closings add column if not exists cash_difference numeric;
alter table public.cash_closings add column if not exists notes text;
alter table public.cash_closings add column if not exists expected_source text;
revoke insert, update, delete, truncate, references, trigger on table public.cash_closings from anon, authenticated;
grant select on table public.cash_closings to anon, authenticated;
grant select, insert on table public.cash_closings to service_role;

-- D
create table if not exists public.finance_period_locks (
  outlet_id uuid primary key,
  locked_through date not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  note text
);
alter table public.finance_period_locks enable row level security;
revoke all on table public.finance_period_locks from anon, authenticated;
grant select, insert, update on table public.finance_period_locks to service_role;

create or replace function public.finance_locked_through(p_outlet uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select locked_through from public.finance_period_locks where outlet_id = p_outlet
$$;
-- Hanya tanggal kunci yang terbaca (dipakai trigger di bawah saat pemanggilnya anon).
grant execute on function public.finance_locked_through(uuid) to anon, authenticated, service_role;

create or replace function public.guard_finance_period()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  lock_new date;
  lock_old date;
  day_new date;
  day_old date;
begin
  -- Hanya browser (anon/authenticated) yang terkena kunci; server (service_role) tidak.
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    lock_new := public.finance_locked_through(new.outlet_id);
    day_new := (new.created_at at time zone 'Asia/Jakarta')::date;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    lock_old := public.finance_locked_through(old.outlet_id);
    day_old := (old.created_at at time zone 'Asia/Jakarta')::date;
  end if;

  if tg_op = 'INSERT' then
    if lock_new is not null and day_new <= lock_new then
      raise exception 'Periode sudah ditutup buku (s.d. %). Hubungi owner.', lock_new using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if lock_old is not null and day_old <= lock_old then
      raise exception 'Periode sudah ditutup buku (s.d. %). Hubungi owner.', lock_old using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: pindah ke periode terkunci selalu ditolak.
  if lock_new is not null and day_new <= lock_new and (new.created_at is distinct from old.created_at or new.outlet_id is distinct from old.outlet_id) then
    raise exception 'Periode sudah ditutup buku (s.d. %). Hubungi owner.', lock_new using errcode = '42501';
  end if;
  if lock_old is not null and day_old <= lock_old then
    if tg_table_name = 'transactions' then
      -- Transaksi lama: status/void/pelunasan boleh; nilai & cara bayar tidak.
      if new.amount is distinct from old.amount
        or new.delivery_fee is distinct from old.delivery_fee
        or new.payment_method is distinct from old.payment_method
        or new.order_type is distinct from old.order_type
        or new.created_at is distinct from old.created_at
        or new.outlet_id is distinct from old.outlet_id then
        raise exception 'Periode sudah ditutup buku (s.d. %): nilai transaksi tidak bisa diubah.', lock_old using errcode = '42501';
      end if;
    else
      raise exception 'Periode sudah ditutup buku (s.d. %). Hubungi owner.', lock_old using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_finance_period on public.transactions;
create trigger guard_finance_period before insert or update or delete on public.transactions
  for each row execute function public.guard_finance_period();
drop trigger if exists guard_finance_period on public.expenses;
create trigger guard_finance_period before insert or update or delete on public.expenses
  for each row execute function public.guard_finance_period();
drop trigger if exists guard_finance_period on public.membership_logs;
create trigger guard_finance_period before insert or update or delete on public.membership_logs
  for each row execute function public.guard_finance_period();

-- Server menghitung saldo laci (closing) dengan data yang sama dengan neraca.
grant select on table public.transactions, public.membership_logs, public.expenses, public.cash_deposits, public.app_settings to service_role;

notify pgrst, 'reload schema';

-- Rollback:
--   drop trigger if exists guard_finance_period on public.transactions;
--   drop trigger if exists guard_finance_period on public.expenses;
--   drop trigger if exists guard_finance_period on public.membership_logs;
--   (kolom/tabel baru boleh dibiarkan; tidak dipakai kode lama)
