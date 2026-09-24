-- Synthetic fixture: pg_dump 16 of a scratch database built from supabase/migrations/20260830_atomic_deposit.sql
-- plus a fake webhook (hooks.example-n8n.test) and fake rows. No production content.
--
-- PostgreSQL database dump
--

\restrict hAtmB5E1hCR0Fg3gzUWDws2LEsoaePcO54NwKwYTWFeyrgeh9IrRQKQByCMhKwW

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: auth_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_role() RETURNS text
    LANGUAGE sql STABLE
    AS $$ select coalesce(current_setting('request.jwt.claim.role', true), 'anon') $$;


--
-- Name: credit_customer_deposit(text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: customer_phone_keys(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_phone_keys(p_phone text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: decrement_customer_deposit(text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_customer_deposit(p_phone text, p_amount numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: notify_ops(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_ops() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform net.http_post(url := 'https://hooks.example-n8n.test/webhook/ops', body := '{}'::jsonb);
  return new;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    phone text NOT NULL,
    name text,
    deposit_balance numeric DEFAULT 0
);


--
-- Name: deposit_payment_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deposit_payment_credits (
    payment_id text NOT NULL,
    customer_phone text,
    amount numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pickup_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_phone text,
    pickup_date date NOT NULL,
    status text
);


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customers (phone, name, deposit_balance) FROM stdin;
081234567890	Pelanggan Nyata	50000
\.


--
-- Data for Name: deposit_payment_credits; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.deposit_payment_credits (payment_id, customer_phone, amount, created_at) FROM stdin;
pay-1	081234567890	50000	2026-09-24 05:28:46.097357+00
\.


--
-- Data for Name: pickup_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pickup_orders (id, customer_phone, pickup_date, status) FROM stdin;
\.


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (phone);


--
-- Name: deposit_payment_credits deposit_payment_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposit_payment_credits
    ADD CONSTRAINT deposit_payment_credits_pkey PRIMARY KEY (payment_id);


--
-- Name: pickup_orders pickup_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_orders
    ADD CONSTRAINT pickup_orders_pkey PRIMARY KEY (id);


--
-- Name: pickup_orders n8n_new_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER n8n_new_order AFTER INSERT ON public.pickup_orders FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://hooks.example-n8n.test/webhook/abc-123', 'POST', '{"Content-type":"application/json","Authorization":"Bearer FixtureTokenAbcdefghijklmnop123"}', '{}', '5000');


--
-- Name: deposit_payment_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deposit_payment_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: pickup_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pickup_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: pickup_orders service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_only ON public.pickup_orders USING ((public.auth_role() = 'service_role'::text));


--
-- Name: FUNCTION credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text) TO anon;
GRANT ALL ON FUNCTION public.credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text) TO authenticated;
GRANT ALL ON FUNCTION public.credit_customer_deposit(p_phone text, p_amount numeric, p_payment_id text) TO service_role;


--
-- Name: FUNCTION decrement_customer_deposit(p_phone text, p_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decrement_customer_deposit(p_phone text, p_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decrement_customer_deposit(p_phone text, p_amount numeric) TO anon;
GRANT ALL ON FUNCTION public.decrement_customer_deposit(p_phone text, p_amount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.decrement_customer_deposit(p_phone text, p_amount numeric) TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict hAtmB5E1hCR0Fg3gzUWDws2LEsoaePcO54NwKwYTWFeyrgeh9IrRQKQByCMhKwW

