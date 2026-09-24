-- STAGING ONLY — synthetic fixtures for the PR #5 staging tests.
-- Run by scripts/staging/prepare.ts (after its guard) inside one transaction.
-- Nothing here comes from production. Markers: names start with "[STAGING]",
-- phones 0800000000xx (toll-free prefix, never a real mobile number),
-- usernames stg_*, ids e5e50000-….
-- Passwords are NOT set here: the staging runner sets random ones per run.
-- Idempotent: only inserts rows that are missing.

insert into outlets (id, name, city, address_detail, latitude, longitude, is_coming_soon)
select v.id::uuid, v.name, v.city, v.addr, v.lat, v.lon, false
from (values
  ('e5e50000-0000-4000-8000-00000000000a', '[STAGING] Outlet Uji A', 'Bandung', '[STAGING] Jl. Uji No. 1, Coblong, Bandung', -6.8853, 107.6195),
  ('e5e50000-0000-4000-8000-00000000000b', '[STAGING] Outlet Uji B', 'Semarang', '[STAGING] Jl. Uji No. 2, Semarang', -6.99, 110.42)
) as v(id, name, city, addr, lat, lon)
where not exists (select 1 from outlets o where o.id = v.id::uuid);

-- Only the columns the order flow needs. The column list must match the
-- production schema (not the local E2E schema): prepare.ts / check-seed.ts
-- verify every INSERT here against the sanitised dump before applying.
insert into app_settings (id, dynamic_services)
select 1,
  '[{"id":"stg1","name":"Cuci Kering Lipat","type":"kg","price":5000},{"id":"stg3","name":"Cuci Setrika","type":"kg","price":6000},{"id":"stg2","name":"Bedcover Single","type":"pcs","price":25000}]'
where not exists (select 1 from app_settings where id = 1);

-- registered_by is NOT NULL in production; the app stores the name of the
-- employee who registered the customer (POS: employeeName), so the synthetic
-- customers are registered by the synthetic cashier of outlet A.
insert into customers (phone, name, registered_by)
select v.phone, v.name, '[STAGING] Kasir A'
from (values ('080000000001', '[STAGING] Pelanggan Uji'), ('080000000002', '[STAGING] Pelanggan Lain')) as v(phone, name)
where not exists (select 1 from customers c where c.phone = v.phone);

insert into customer_addresses (customer_phone, label_name, full_address, is_primary, latitude, longitude)
select '080000000001', 'Rumah', '[STAGING] jl uji coblong no.1 bandung', true, -6.886, 107.613
where not exists (select 1 from customer_addresses a where a.customer_phone = '080000000001');

insert into employees (id, name, role, outlet_id, username, password)
select v.id::uuid, v.name, v.role, v.outlet::uuid, v.username, '!disabled-' || gen_random_uuid()
from (values
  ('e5e50000-0000-4000-8000-0000000000e1', '[STAGING] Kasir A', 'kasir', 'e5e50000-0000-4000-8000-00000000000a', 'stg_kasir_a'),
  ('e5e50000-0000-4000-8000-0000000000e2', '[STAGING] Kasir B', 'kasir', 'e5e50000-0000-4000-8000-00000000000b', 'stg_kasir_b'),
  ('e5e50000-0000-4000-8000-0000000000e3', '[STAGING] CS', 'cs', null, 'stg_cs'),
  ('e5e50000-0000-4000-8000-0000000000e4', '[STAGING] Driver A', 'driver', 'e5e50000-0000-4000-8000-00000000000a', 'stg_driver_a')
) as v(id, name, role, outlet, username)
where not exists (select 1 from employees e where e.id = v.id::uuid);
