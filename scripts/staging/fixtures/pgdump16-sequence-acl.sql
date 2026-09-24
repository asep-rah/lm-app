--
-- PostgreSQL database dump
--

\restrict DCEm4XK2e6aydPwJOLyBf7FrEHsBSwoE9kpYWlmGk4yRkXVfNM0DR7eeHR2CPU0

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.error_logs (
    id bigint NOT NULL,
    source text,
    message text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.error_logs OWNER TO postgres;

--
-- Name: error_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.error_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.error_logs_id_seq OWNER TO postgres;

--
-- Name: error_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.error_logs_id_seq OWNED BY public.error_logs.id;


--
-- Name: pickup_order_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pickup_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pickup_order_seq OWNER TO postgres;

--
-- Name: pickup_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pickup_orders (
    id bigint DEFAULT nextval('public.pickup_order_seq'::regclass) NOT NULL,
    customer_phone text,
    pickup_date timestamp with time zone NOT NULL,
    status text DEFAULT 'Menunggu Kurir'::text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.pickup_orders OWNER TO postgres;

--
-- Name: system_tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    assigned_to_role text,
    source_id uuid,
    status text
);


ALTER TABLE public.system_tasks OWNER TO postgres;

--
-- Name: error_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.error_logs ALTER COLUMN id SET DEFAULT nextval('public.error_logs_id_seq'::regclass);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: pickup_orders pickup_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pickup_orders
    ADD CONSTRAINT pickup_orders_pkey PRIMARY KEY (id);


--
-- Name: system_tasks system_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_tasks
    ADD CONSTRAINT system_tasks_pkey PRIMARY KEY (id);


--
-- Name: pickup_orders anon insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "anon insert" ON public.pickup_orders FOR INSERT TO anon WITH CHECK (true);


--
-- Name: pickup_orders anon_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY anon_read ON public.pickup_orders FOR SELECT TO anon, authenticated USING (true);


--
-- Name: pickup_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pickup_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: SEQUENCE pickup_order_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE public.pickup_order_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.pickup_order_seq TO authenticated;


--
-- PostgreSQL database dump complete
--

\unrestrict DCEm4XK2e6aydPwJOLyBf7FrEHsBSwoE9kpYWlmGk4yRkXVfNM0DR7eeHR2CPU0

