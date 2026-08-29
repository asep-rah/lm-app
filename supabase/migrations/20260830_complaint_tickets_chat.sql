-- Dedicated complaint ticket rooms, isolated from support_chats.
-- Room + messages expire 24 hours after status = resolved.

create table if not exists complaint_tickets (
  id uuid primary key default gen_random_uuid(),
  transaction_id text,
  customer_phone text,
  issue_description text,
  status text not null default 'open',
  created_at timestamptz default now(),
  resolved_at timestamptz,
  outlet_issue_id text,
  pickup_id text,
  receipt_number text,
  constraint complaint_tickets_status_chk check (status in ('open', 'resolved'))
);

create table if not exists complaint_chat_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references complaint_tickets(id) on delete cascade,
  sender_type text not null,
  message text,
  attachment_url text,
  created_at timestamptz default now(),
  constraint complaint_chat_sender_chk check (sender_type in ('customer', 'cs'))
);

create index if not exists complaint_tickets_status_idx on complaint_tickets (status, resolved_at);
create index if not exists complaint_tickets_issue_idx on complaint_tickets (outlet_issue_id);
create index if not exists complaint_tickets_tx_idx on complaint_tickets (transaction_id);
create index if not exists complaint_tickets_phone_idx on complaint_tickets (customer_phone);
create index if not exists complaint_chat_ticket_idx on complaint_chat_messages (ticket_id, created_at);

create or replace function cleanup_resolved_complaint_tickets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  delete from complaint_chat_messages
  where ticket_id in (
    select id
    from complaint_tickets
    where status = 'resolved'
      and resolved_at is not null
      and resolved_at < now() - interval '24 hours'
  );

  delete from complaint_tickets
  where status = 'resolved'
    and resolved_at is not null
    and resolved_at < now() - interval '24 hours';

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function cleanup_resolved_complaint_tickets() from public;
grant execute on function cleanup_resolved_complaint_tickets() to anon, authenticated, service_role;

grant all on complaint_tickets to anon, authenticated, service_role;
grant all on complaint_chat_messages to anon, authenticated, service_role;

alter table complaint_tickets enable row level security;
alter table complaint_chat_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'complaint_tickets' and policyname = 'complaint_tickets_all'
  ) then
    create policy complaint_tickets_all on complaint_tickets for all using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'complaint_chat_messages' and policyname = 'complaint_chat_messages_all'
  ) then
    create policy complaint_chat_messages_all on complaint_chat_messages for all using (true) with check (true);
  end if;
end $$;

alter table complaint_tickets replica identity full;
alter table complaint_chat_messages replica identity full;

do $$
begin
  alter publication supabase_realtime add table complaint_tickets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table complaint_chat_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
