-- Anti-collision CS chat. Kolom pada support_chats nullable agar insert lama tetap lolos.
-- Session table adalah sumber klaim/handover; pesan tetap di support_chats.

alter table support_chats
  add column if not exists assigned_to_agent_id text,
  add column if not exists assigned_to_agent_name text,
  add column if not exists is_claimed boolean default false,
  add column if not exists is_internal boolean default false,
  add column if not exists is_resolved boolean default false,
  add column if not exists thread_key text,
  add column if not exists sender_name text;

create index if not exists idx_support_chats_thread on support_chats (thread_key);
create index if not exists idx_support_chats_phone on support_chats (customer_phone);

create table if not exists support_chat_sessions (
  thread_key             text primary key,
  customer_phone         text,
  assigned_to_agent_id   text,
  assigned_to_agent_name text,
  is_claimed             boolean default false,
  is_resolved            boolean default false,
  resolved_at            timestamptz,
  first_customer_at      timestamptz,
  first_cs_at            timestamptz,
  last_message_at        timestamptz,
  last_sender_type       text,
  last_preview           text,
  handover_reason        text,
  csat_score             integer,
  created_at             timestamptz default now()
);

create index if not exists idx_chat_sessions_claimed on support_chat_sessions (is_claimed, is_resolved);

grant all on support_chat_sessions to anon, authenticated;

alter table support_chat_sessions replica identity full;

do $$
begin
  alter publication supabase_realtime add table support_chat_sessions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
