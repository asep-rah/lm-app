-- Synthetic fixture: pg_dump 18.6 of a scratch PostgreSQL 17 database (no production content).
--
-- PostgreSQL database dump
--

\restrict 2cHaXyUzBeAFsqazYus7ECHeosyQAEV3jB8PUbdSXPQ4qWb0lB8CtVJ47KcZQEi

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: pickup_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text,
    pickup_date date NOT NULL,
    pickup_time time without time zone
);


--
-- Name: pickup_orders pickup_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_orders
    ADD CONSTRAINT pickup_orders_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict 2cHaXyUzBeAFsqazYus7ECHeosyQAEV3jB8PUbdSXPQ4qWb0lB8CtVJ47KcZQEi

