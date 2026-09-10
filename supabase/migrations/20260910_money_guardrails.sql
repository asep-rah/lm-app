-- Guardrail uang investor: soft-void, larang hard-delete transaksi via anon,
-- deposit credit/debit hanya service_role (client lewat /api/deposit/mutate).

alter table public.transactions
  add column if not exists is_void boolean default false,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by text;

create index if not exists transactions_is_void_idx on public.transactions (is_void)
  where is_void = true;

-- Soft-void only: anon/authenticated tidak boleh DELETE baris transaksi.
revoke delete on public.transactions from anon, authenticated;

-- RPC mutasi saldo: jangan dipanggil publik dengan publishable key.
revoke all on function public.decrement_customer_deposit(text, numeric) from public, anon, authenticated;
revoke all on function public.credit_customer_deposit(text, numeric, text) from public, anon, authenticated;
grant execute on function public.decrement_customer_deposit(text, numeric) to service_role;
grant execute on function public.credit_customer_deposit(text, numeric, text) to service_role;

-- deposit_payment_credits: pastikan RLS on + no anon policies (deny).
alter table public.deposit_payment_credits enable row level security;
revoke all on public.deposit_payment_credits from anon, authenticated;

comment on column public.transactions.is_void is 'Soft-void; jangan hard-delete. Omset/KPI mengabaikan baris ini.';
