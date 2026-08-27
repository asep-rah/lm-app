-- Kolom items menyimpan rincian item satuan (Bedcover, Sepatu, Jas, dll) sebagai JSON
-- terstruktur. Sebelumnya rincian ini hanya ada sebagai teks di dalam `notes`, sehingga
-- POS tidak bisa memuatnya ke cartItems dan upah/komisi per item tidak bisa dihitung.
--
-- Bentuk tiap elemen:
--   { "name": "Bedcover Double", "qty": 1, "price": 25000, "basePrice": 25000,
--     "duration": "Reguler (3 Hari)", "type": "pcs" }

alter table pickup_orders
  add column if not exists items jsonb default '[]'::jsonb;

alter table transactions
  add column if not exists items jsonb default '[]'::jsonb;
