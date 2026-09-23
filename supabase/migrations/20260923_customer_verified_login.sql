-- Customer verified login (WhatsApp via Evolution API + email code fallback).
--
-- Additive only: two NEW tables, no change to existing tables/columns.
-- Both tables are server-only: RLS on, no policy, all grants revoked from
-- anon/authenticated. Access exclusively through Next.js API routes using
-- SUPABASE_SERVICE_ROLE_KEY (service_role bypasses RLS).
--
-- Rollback (safe, no other table references these):
--   drop table if exists public.customer_login_challenges;
--   drop table if exists public.customer_auth_identities;

create extension if not exists pgcrypto;

-- 1) One row per login/verification attempt. Codes and browser nonces are
--    stored ONLY as HMAC hashes (never plaintext).
create table if not exists public.customer_login_challenges (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'email_login', 'email_link')),
  -- Canonical phone 62xxxxxxxx (whatsapp / email_link owner / email_login resolved owner)
  phone text,
  email text,
  code_hash text not null,
  -- HMAC of the HttpOnly nonce cookie of the browser that started the request
  nonce_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'consumed', 'expired', 'failed')),
  fail_reason text,
  attempts integer not null default 0,
  ip text,
  user_agent text,
  -- Evolution message id that verified this challenge (webhook replay guard)
  provider_message_id text,
  sender text,
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists customer_login_challenges_code_hash_uq
  on public.customer_login_challenges (code_hash);
create unique index if not exists customer_login_challenges_provider_msg_uq
  on public.customer_login_challenges (provider_message_id)
  where provider_message_id is not null;
create index if not exists customer_login_challenges_phone_created_idx
  on public.customer_login_challenges (phone, created_at desc);
create index if not exists customer_login_challenges_email_created_idx
  on public.customer_login_challenges (lower(email), created_at desc);
create index if not exists customer_login_challenges_ip_created_idx
  on public.customer_login_challenges (ip, created_at desc);

-- 2) Verified backup identities per customer (keyed by canonical phone, the
--    same identity used by customers / transactions / pickup_orders).
create table if not exists public.customer_auth_identities (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  email text not null,
  email_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One verified email per customer, and one customer per email: an email can
-- never silently point to two accounts (no merge by unverified data).
create unique index if not exists customer_auth_identities_phone_uq
  on public.customer_auth_identities (customer_phone);
create unique index if not exists customer_auth_identities_email_uq
  on public.customer_auth_identities (lower(email));

alter table public.customer_login_challenges enable row level security;
alter table public.customer_auth_identities enable row level security;

revoke all on public.customer_login_challenges from anon, authenticated;
revoke all on public.customer_auth_identities from anon, authenticated;

comment on table public.customer_login_challenges is
  'Login customer (WA/email). Hanya service role via API. Kode & nonce disimpan sebagai HMAC.';
comment on table public.customer_auth_identities is
  'Email cadangan terverifikasi per customer (phone kanonik 62...). Hanya service role via API.';
