-- Thread CS yang sudah resolved/closed bisa dibuka ulang saat customer kirim pesan baru.
alter table support_chat_sessions
  add column if not exists status text default 'unassigned',
  add column if not exists waiting_since timestamptz,
  add column if not exists updated_at timestamptz default now();

alter table support_chats
  add column if not exists status text;

-- Realtime /cs butuh old+new row saat session di-reopen.
alter table support_chats replica identity full;
alter table support_chat_sessions replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table support_chats;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table support_chat_sessions;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
