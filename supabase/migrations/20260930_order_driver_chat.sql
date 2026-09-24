-- In-app chat between the assigned driver and the customer of one pickup
-- order (like Grab/Gojek). Server-only: every read/write goes through
-- /api/customer/driver-chat (customer session / legacy phone, own orders only)
-- and /api/staff/driver-chat (signed staff session, role driver, own orders
-- only), using the service role. The browser (anon/authenticated) has no
-- access, so a customer cannot read another customer's chat.
--
-- Only ADDS a table; no existing table or data changes. Idempotent.
-- Rollback: drop table if exists public.order_driver_chats;

create table if not exists public.order_driver_chats (
  id uuid primary key default gen_random_uuid(),
  pickup_order_id uuid not null references public.pickup_orders(id) on delete cascade,
  sender_type text not null check (sender_type in ('driver', 'customer')),
  sender_name text,
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists order_driver_chats_order_idx
  on public.order_driver_chats (pickup_order_id, created_at);
create index if not exists order_driver_chats_unread_idx
  on public.order_driver_chats (pickup_order_id, sender_type)
  where read_at is null;

alter table public.order_driver_chats enable row level security;

-- Production default privileges do not give service_role DML on new tables
-- (see docs/RELEASE_PR5_RUNBOOK.md): grant exactly what the server uses.
revoke all on table public.order_driver_chats from anon, authenticated;
grant select, insert, update on table public.order_driver_chats to service_role;
