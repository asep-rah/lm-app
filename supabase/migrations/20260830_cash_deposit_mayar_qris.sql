-- Dynamic Mayar QRIS for kasir daily cash deposit closing.

alter table cash_deposits add column if not exists cashier_id text;
alter table cash_deposits add column if not exists kasir_id text;
alter table cash_deposits add column if not exists amount_cash numeric default 0;
alter table cash_deposits add column if not exists admin_fee numeric default 0;
alter table cash_deposits add column if not exists net_deposit_amount numeric default 0;
alter table cash_deposits add column if not exists deposit_method text;
alter table cash_deposits add column if not exists proof_url text;
alter table cash_deposits add column if not exists qr_payment_status text default 'pending';
alter table cash_deposits add column if not exists status text default 'PENDING';
alter table cash_deposits add column if not exists status_qris text default 'pending';
alter table cash_deposits add column if not exists mayar_payment_id text;
alter table cash_deposits add column if not exists mayar_invoice_url text;
alter table cash_deposits add column if not exists qris_image_url text;
alter table cash_deposits add column if not exists receipt text;
alter table cash_deposits add column if not exists shift_date date;
alter table cash_deposits add column if not exists paid_at timestamptz;
alter table cash_deposits add column if not exists expense_id uuid;

create index if not exists cash_deposits_mayar_idx on cash_deposits (mayar_payment_id);
create index if not exists cash_deposits_status_idx on cash_deposits (status, created_at desc);

grant all on cash_deposits to anon, authenticated;

alter table cash_deposits replica identity full;

do $$
begin
  alter publication supabase_realtime add table cash_deposits;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
