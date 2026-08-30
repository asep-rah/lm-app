-- Outlet profile showcase, promo banners, coming-soon teasers, Google Business fields.
-- latitude / longitude may already exist from older GPS absensi columns.

alter table outlets add column if not exists latitude double precision;
alter table outlets add column if not exists longitude double precision;
alter table outlets add column if not exists address_detail text;
alter table outlets add column if not exists images text[];
alter table outlets add column if not exists operating_hours text;
alter table outlets add column if not exists is_coming_soon boolean default false;
alter table outlets add column if not exists opening_date_info text;
alter table outlets add column if not exists google_place_id text;
alter table outlets add column if not exists google_rating double precision default 5.0;
alter table outlets add column if not exists google_review_count integer default 0;
alter table outlets add column if not exists google_maps_url text;

update outlets set google_rating = 5.0 where google_rating is null;
update outlets set google_review_count = 0 where google_review_count is null;
update outlets set is_coming_soon = false where is_coming_soon is null;

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  title text,
  banner_url text,
  description text,
  outlet_id uuid references outlets(id) on delete set null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_promotions_active
  on promotions (is_active, created_at desc);

grant all on promotions to anon, authenticated;

alter table promotions replica identity full;

do $$
begin
  alter publication supabase_realtime add table promotions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Public photo buckets for owner uploads (ignored if storage schema is locked).
do $$
begin
  insert into storage.buckets (id, name, public)
  values
    ('outlet-photos', 'outlet-photos', true),
    ('promo-banners', 'promo-banners', true)
  on conflict (id) do nothing;
exception
  when undefined_table then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'outlet_photos_public_read'
  ) then
    create policy outlet_photos_public_read on storage.objects
      for select using (bucket_id = 'outlet-photos');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'outlet_photos_public_write'
  ) then
    create policy outlet_photos_public_write on storage.objects
      for insert with check (bucket_id = 'outlet-photos');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'promo_banners_public_read'
  ) then
    create policy promo_banners_public_read on storage.objects
      for select using (bucket_id = 'promo-banners');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'promo_banners_public_write'
  ) then
    create policy promo_banners_public_write on storage.objects
      for insert with check (bucket_id = 'promo-banners');
  end if;
exception
  when undefined_table then null;
  when insufficient_privilege then null;
  when duplicate_object then null;
end $$;
