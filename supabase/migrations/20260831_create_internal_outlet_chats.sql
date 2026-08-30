-- Grup Koordinasi Outlet (internal chat per cabang).
-- Live schema cache error: public.internal_outlet_chats missing.
-- sender_id is UUID without FK to public.profiles — that table is not in this project
-- (staff ids live on employees / local session).

create table if not exists public.internal_outlet_chats (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete cascade,
  sender_id uuid,
  sender_name text not null default '',
  sender_role text not null default '',
  message text not null,
  attachment_url text,
  created_at timestamptz default now()
);

alter table public.internal_outlet_chats add column if not exists sender_id uuid;
alter table public.internal_outlet_chats add column if not exists sender_name text;
alter table public.internal_outlet_chats add column if not exists sender_role text;
alter table public.internal_outlet_chats add column if not exists attachment_url text;
alter table public.internal_outlet_chats add column if not exists created_at timestamptz default now();

alter table public.internal_outlet_chats alter column sender_name set default '';
alter table public.internal_outlet_chats alter column sender_role set default '';
update public.internal_outlet_chats set sender_name = coalesce(sender_name, '') where sender_name is null;
update public.internal_outlet_chats set sender_role = coalesce(sender_role, '') where sender_role is null;
alter table public.internal_outlet_chats alter column sender_name set not null;
alter table public.internal_outlet_chats alter column sender_role set not null;
alter table public.internal_outlet_chats alter column message set not null;

create index if not exists idx_internal_outlet_chats_room
  on public.internal_outlet_chats (outlet_id, created_at);

alter table public.internal_outlet_chats enable row level security;

do $$
begin
  create policy "Allow authenticated users to read and insert chat"
    on public.internal_outlet_chats
    for all
    using (auth.role() = 'authenticated' or auth.role() = 'anon')
    with check (auth.role() = 'authenticated' or auth.role() = 'anon');
exception
  when duplicate_object then null;
end $$;

grant all on public.internal_outlet_chats to anon, authenticated;

alter table public.internal_outlet_chats replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.internal_outlet_chats;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
