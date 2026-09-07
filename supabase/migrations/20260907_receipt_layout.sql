alter table app_settings
  add column if not exists receipt_layout jsonb;
