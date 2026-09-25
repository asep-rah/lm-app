# Runbook rilis: chat driver, form order tanpa pilihan bawaan, tombol keluar owner

Perubahan di rilis ini:

- **Form order pelanggan**: semua pilihan layanan dimulai kosong, tanpa badge "Express" di samping durasi. Customer memilih sendiri jumlah kantong, proses cuci, luntur, jenis kiloan, durasi, item satuan, dan durasi item.
- **Owner**: tombol **Keluar / Logout Sesi** kini terlihat. Sebelumnya tombol tertutup dock bawah dan tidak punya warna, karena kelas daisyUI tidak aktif di Tailwind v4.
- **Chat driver ↔ pelanggan** di dalam aplikasi. Chat memakai tabel baru `order_driver_chats`.

## Urutan

1. **Migrasi dulu**, di Supabase SQL Editor produksi. Jalankan isi `supabase/migrations/20260930_order_driver_chat.sql` persis seperti di file.
   - Migrasi hanya **menambah** satu tabel. Tabel dan data lain tidak berubah.
   - Migrasi idempoten, jadi aman dijalankan ulang.
   - Bila deploy lebih dulu, tombol chat tetap muncul, tetapi chat menampilkan "Chat belum bisa dimuat" dan error tercatat di `/owner/system-health`. Fitur lain tidak terpengaruh.
2. **Merge PR → deploy Production** (otomatis di Vercel).
3. Tidak ada env baru. Chat driver memakai `STAFF_SESSION_SECRET` yang sudah ada. Driver yang sesinya berakhir harus keluar lalu masuk lagi.

## Cek setelah migrasi (read-only)

```sql
select has_table_privilege('service_role', 'public.order_driver_chats', 'SELECT') s,
       has_table_privilege('service_role', 'public.order_driver_chats', 'INSERT') i,
       has_table_privilege('service_role', 'public.order_driver_chats', 'UPDATE') u,
       has_table_privilege('anon', 'public.order_driver_chats', 'SELECT') anon_s,
       has_table_privilege('authenticated', 'public.order_driver_chats', 'SELECT') auth_s,
       (select relrowsecurity from pg_class where oid = 'public.order_driver_chats'::regclass) rls;
```

Hasil yang diharapkan: `s`, `i`, `u` dan `rls` bernilai `true`; `anon_s` dan `auth_s` bernilai `false`.

## Uji singkat di produksi (akun/nomor internal)

1. Buat 1 pesanan jemput dari aplikasi pelanggan. Di langkah Layanan, pastikan semua pilihan kosong dan tombol Tambah menolak sebelum dipilih.
2. Driver internal (sudah check-in) menggeser **Geser untuk jemput**. Tombol **Chat Pelanggan** muncul.
3. Pelanggan membuka *Aktivitas → Berlangsung* → **Chat Driver** dan mengirim pesan.
4. Driver melihat badge dalam ±15 detik, membuka chat, lalu membalas. Pelanggan menerima balasan dan melihat tanda *Dibaca* pada pesannya.
5. Setelah foto serah terima ke outlet, chat menjadi hanya-baca.
6. Owner: Menu → tombol merah **Keluar** di bawah → kembali ke `/login`.

## Rollback

- Aplikasi: rollback deploy di Vercel ke versi sebelumnya. Tabel chat boleh dibiarkan.
- Tabel, hanya bila benar-benar ingin menghapus fitur beserta isinya: `drop table if exists public.order_driver_chats;`
