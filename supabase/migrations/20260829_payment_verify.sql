alter table transactions
  add column if not exists payment_status text,
  add column if not exists payment_proof_url text;

alter table support_chats
  add column if not exists attachment_url text,
  add column if not exists attachment_type text;
