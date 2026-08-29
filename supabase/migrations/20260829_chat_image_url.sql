alter table support_chats
  add column if not exists image_url text,
  add column if not exists attachment_url text,
  add column if not exists attachment_type text;
