-- LOCAL TEST DATABASE ONLY. Test fixtures for the order/photo E2E.
insert into outlets (id, name, city, address_detail, latitude, longitude) values
  ('11111111-1111-4111-8111-111111111111', 'Laundry Hari ini - Tubagus', '-',
   'Jl. Tubagus Ismail Raya No. 12, Dago, Coblong, Kota Bandung, Jawa Barat 40134', -6.8853, 107.6195),
  ('22222222-2222-4222-8222-222222222222', 'Outlet Semarang', 'Semarang', null, -6.99, 110.42);

insert into app_settings (id, dynamic_services, outlet_overrides, receipt_terms, promos_data) values
  (1, '[{"id":"s1","name":"Cuci Kering Lipat","type":"kg","price":5000},{"id":"s3","name":"Cuci Setrika","type":"kg","price":6000},{"id":"s2","name":"Bedcover Single","type":"pcs","price":25000}]',
   '{}', 'S&K uji coba', '[]');

insert into customers (phone, name) values ('085172141494', 'Asep Rahmat'), ('081299990000', 'Pelanggan Lain');

insert into customer_addresses (customer_phone, label_name, full_address, is_primary, latitude, longitude) values
  ('085172141494', 'Rumah', 'jl ir juanda dago no.378 bandung', true, -6.886, 107.613);

-- Plaintext legacy passwords: staff-login verifies and upgrades them to scrypt.
insert into employees (id, name, role, outlet_id, username, password) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Kasir Dago', 'kasir', '11111111-1111-4111-8111-111111111111', 'kasir_dago', 'uji-kasir-1'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Kasir Semarang', 'kasir', '22222222-2222-4222-8222-222222222222', 'kasir_smg', 'uji-kasir-2'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'CS Pusat', 'cs', null, 'cs_pusat', 'uji-cs-3'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'Driver Dago', 'driver', '11111111-1111-4111-8111-111111111111', 'driver_dago', 'uji-driver-4');

-- Driver checked in at Dago so the driver queue shows Dago pickups.
insert into driver_attendance (driver_id, driver_name, active_outlet_id, clock_in_at, status) values
  ('aaaaaaaa-0000-4000-8000-000000000004', 'Driver Dago', '11111111-1111-4111-8111-111111111111', now(), 'ON_DUTY');
