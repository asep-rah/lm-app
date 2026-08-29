-- Foto tahap 3 kurir: ambil cucian jadi dari rak/outlet (terpisah dari serah terima ke kasir).
alter table pickup_orders
  add column if not exists photo_outlet_pickup_url text;
