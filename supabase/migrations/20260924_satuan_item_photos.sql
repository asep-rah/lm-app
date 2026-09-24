-- Foto wajib item satuan (form pesanan customer).
--
-- Bucket PRIVAT dan TANPA policy untuk anon/authenticated sama sekali:
-- - Customer mengunggah lewat signed upload URL yang dibuat server
--   (/api/customer/satuan-photo/upload-url) hanya untuk sesi customer
--   terverifikasi, ke path acak di folder miliknya.
-- - Staf melihat lewat /api/staff/satuan-photo/view: sesi staf bertanda
--   tangan + cek peran/outlet dari DB + foto harus milik pesanan itu; URL
--   bertanda tangan berlaku 5 menit dan setiap akses dicatat di audit_logs.
-- Anon key (yang ada di browser) tidak dapat list, baca, atau membuat signed
-- URL untuk objek di bucket ini.
--
-- Aman dijalankan ulang. Bila versi awal migrasi ini (dengan policy
-- satuan_item_photos_write/_read untuk semua peran) sempat dijalankan di
-- staging, policy itu dihapus di bawah.

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('satuan-item-photos', 'satuan-item-photos', false, 5242880, array['image/jpeg'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end $$;

drop policy if exists satuan_item_photos_write on storage.objects;
drop policy if exists satuan_item_photos_read on storage.objects;
