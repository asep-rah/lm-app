-- Web Push subscriptions for customer + staff apps.
-- Run this in Supabase SQL Editor. Migration files do not create live tables by themselves.

create table if not exists user_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text,
  endpoint text not null,
  p256dh text,
  auth text,
  keys jsonb,
  outlet_id text,
  created_at timestamptz default now()
);

create unique index if not exists user_push_subscriptions_endpoint_uidx
  on user_push_subscriptions (endpoint);

create index if not exists user_push_subscriptions_user_idx
  on user_push_subscriptions (user_id);

create index if not exists user_push_subscriptions_role_idx
  on user_push_subscriptions (role);

grant all on user_push_subscriptions to anon, authenticated;
alter table user_push_subscriptions replica identity full;

do $$
begin
  alter publication supabase_realtime add table user_push_subscriptions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
