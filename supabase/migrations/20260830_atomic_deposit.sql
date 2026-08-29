-- Atomic deposit debit/credit. Idempotensi top-up lewat payment_id unik.

create table if not exists deposit_payment_credits (
  payment_id text primary key,
  customer_phone text not null,
  amount numeric not null,
  created_at timestamptz default now()
);

create or replace function customer_phone_keys(p_phone text)
returns text[]
language sql
immutable
as $$
  with d as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits
  )
  select array_remove(array[
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(d.digits, ''),
    case when d.digits like '62%' and length(d.digits) > 4 then '0' || substring(d.digits from 3) end,
    case when d.digits like '0%' and length(d.digits) > 4 then '62' || substring(d.digits from 2) end,
    case when d.digits like '8%' and length(d.digits) between 9 and 13 then '0' || d.digits end
  ], null)
  from d;
$$;

create or replace function decrement_customer_deposit(p_phone text, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_new numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal potong deposit tidak valid';
  end if;

  select c.phone into v_phone
  from customers c
  where c.phone = any (customer_phone_keys(p_phone))
  limit 1
  for update;

  if v_phone is null then
    raise exception 'Pelanggan tidak ditemukan';
  end if;

  update customers
  set deposit_balance = coalesce(deposit_balance, 0) - p_amount
  where phone = v_phone
    and coalesce(deposit_balance, 0) >= p_amount
  returning deposit_balance into v_new;

  if v_new is null then
    raise exception 'Saldo deposit tidak cukup';
  end if;

  return v_new;
end;
$$;

create or replace function credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_new numeric;
  v_keys text[];
  v_pid text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal kredit deposit tidak valid';
  end if;

  v_keys := customer_phone_keys(p_phone);
  v_pid := nullif(trim(coalesce(p_payment_id, '')), '');

  if v_pid is not null then
    insert into deposit_payment_credits (payment_id, customer_phone, amount)
    values (v_pid, coalesce(nullif(v_keys[1], ''), trim(p_phone)), p_amount)
    on conflict (payment_id) do nothing;
    if not found then
      select c.phone, coalesce(c.deposit_balance, 0)
        into v_phone, v_new
      from deposit_payment_credits d
      left join customers c on c.phone = any (customer_phone_keys(d.customer_phone))
      where d.payment_id = v_pid
      limit 1;
      return coalesce(v_new, p_amount);
    end if;
  end if;

  select c.phone into v_phone
  from customers c
  where c.phone = any (v_keys)
  limit 1
  for update;

  if v_phone is null then
    v_phone := coalesce(nullif(v_keys[1], ''), trim(p_phone));
    insert into customers (phone, name, deposit_balance)
    values (v_phone, 'Pelanggan', p_amount);
    v_new := p_amount;
  else
    update customers
    set deposit_balance = coalesce(deposit_balance, 0) + p_amount
    where phone = v_phone
    returning deposit_balance into v_new;
  end if;

  if v_pid is not null then
    update deposit_payment_credits
    set customer_phone = v_phone
    where payment_id = v_pid;
  end if;

  return v_new;
end;
$$;

revoke all on function decrement_customer_deposit(text, numeric) from public;
revoke all on function credit_customer_deposit(text, numeric, text) from public;
grant execute on function decrement_customer_deposit(text, numeric) to anon, authenticated, service_role;
grant execute on function credit_customer_deposit(text, numeric, text) to anon, authenticated, service_role;

alter table deposit_payment_credits enable row level security;
