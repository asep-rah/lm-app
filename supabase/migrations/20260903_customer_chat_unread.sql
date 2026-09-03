-- Unread badge pelanggan: is_read pada support_chats (tabel chat live).
-- Jalankan di Supabase SQL Editor. File migrasi tidak membuat kolom sendiri.
-- Baris lama ditandai sudah dibaca supaya badge tidak meledak; insert baru default false.

alter table support_chats add column if not exists is_read boolean;
update support_chats set is_read = true where is_read is null;
alter table support_chats alter column is_read set default false;

create index if not exists idx_support_chats_unread
  on support_chats (customer_phone, is_read)
  where is_read = false;

notify pgrst, 'reload schema';
