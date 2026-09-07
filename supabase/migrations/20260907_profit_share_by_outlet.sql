alter table public.app_settings
  add column if not exists profit_share_by_outlet jsonb default '{}'::jsonb;
