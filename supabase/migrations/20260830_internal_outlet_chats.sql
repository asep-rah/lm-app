-- Grup Koordinasi Outlet: chat internal per cabang (bukan Live Chat pelanggan).
create table if not exists internal_outlet_chats (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references outlets(id) on delete cascade,
  sender_name text,
  sender_role text,
  message text not null,
  created_at timestamptz default now()
);

create index if not exists idx_internal_outlet_chats_room
  on internal_outlet_chats (outlet_id, created_at);

grant all on internal_outlet_chats to anon, authenticated;

alter table internal_outlet_chats replica identity full;

do $$
begin
  alter publication supabase_realtime add table internal_outlet_chats;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
