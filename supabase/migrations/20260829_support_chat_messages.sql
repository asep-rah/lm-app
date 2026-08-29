-- Arsip permanen setiap pesan CS (invoice QRIS, konfirmasi bayar, balasan pelanggan).
create table if not exists support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_key text,
  customer_phone text,
  sender_type text,
  sender_name text,
  message text,
  transaction_id uuid,
  order_id uuid,
  pickup_order_id uuid,
  is_internal boolean default false,
  attachment_url text,
  image_url text,
  attachment_type text,
  created_at timestamptz default now()
);

create index if not exists idx_chat_messages_thread on support_chat_messages (thread_key, created_at);
create index if not exists idx_chat_messages_phone on support_chat_messages (customer_phone);

grant all on support_chat_messages to anon, authenticated;

alter table support_chat_messages replica identity full;

do $$
begin
  alter publication supabase_realtime add table support_chat_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
