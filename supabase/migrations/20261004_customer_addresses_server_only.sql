-- Saved customer addresses are written only by the server.
--
-- Until now 20260902 granted ALL on customer_addresses to anon/authenticated:
-- anyone holding the public browser key could insert, change or delete ANY
-- customer's saved address (and its map pin). The customer app now saves
-- through /api/customer/addresses (verified session phone; legacy login
-- phone only while CUSTOMER_LEGACY_LOGIN_ENABLED is on), which only touches
-- rows of that customer's own phone.
--
-- 1. anon/authenticated lose INSERT, UPDATE, DELETE (and TRUNCATE/REFERENCES/
--    TRIGGER from "grant all"). SELECT is KEPT: the CS dashboard still reads
--    addresses in the browser (pickup_orders → customer_addresses). Moving
--    those reads behind the server is a separate step.
-- 2. service_role gets exactly what /api/customer/addresses and
--    /api/staff/pickup-pin need.
--
-- ORDER: deploy the app version that contains /api/customer/addresses FIRST,
-- then run this SQL. Run before that deploy, older app versions could not
-- save addresses (orders themselves are not affected).
-- No data change. Idempotent.
-- Rollback (restores the old, unsafe state):
--   grant insert, update, delete on public.customer_addresses to anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.customer_addresses from anon, authenticated;

grant select, insert, delete on table public.customer_addresses to service_role;
grant update (label_name, full_address, is_primary, latitude, longitude)
  on table public.customer_addresses to service_role;

notify pgrst, 'reload schema';
