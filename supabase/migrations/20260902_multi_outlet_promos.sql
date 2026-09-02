-- Multi-outlet targeting for promo banners.
-- Run this in Supabase SQL Editor. Migration files do not create live tables by themselves.

alter table promotions
  add column if not exists target_outlet_ids text[] default '{ALL}'::text[];

-- Keep existing single-outlet rows targeted at that outlet instead of flipping them to ALL.
update promotions
set target_outlet_ids = array[outlet_id::text]
where outlet_id is not null
  and (
    target_outlet_ids is null
    or target_outlet_ids = array['ALL']::text[]
  );

update promotions
set target_outlet_ids = '{ALL}'::text[]
where target_outlet_ids is null;

create index if not exists idx_promotions_target_outlet_ids
  on promotions using gin (target_outlet_ids);

notify pgrst, 'reload schema';
