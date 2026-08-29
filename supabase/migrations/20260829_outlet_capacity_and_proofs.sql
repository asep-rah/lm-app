alter table outlets
  add column if not exists is_overcapacity boolean default false;

alter table transactions
  add column if not exists rack_photo_url text;

alter table work_logs
  add column if not exists notes text,
  add column if not exists photo_url text;
