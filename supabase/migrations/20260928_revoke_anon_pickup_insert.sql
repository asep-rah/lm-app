-- Last gate before the satuan photo feature: the browser (anon key) can no
-- longer INSERT into pickup_orders.
--
-- Every app path that creates a pickup order now goes through the server
-- (service role, 20260926 / 20260927 grants):
-- - customer order          → /api/customer/order/create (photo rule, session phone)
-- - customer delivery request → /api/customer/delivery-request (own orders only)
-- - staff /admin order form   → /api/staff/pickup-orders (signed staff session)
-- Without this revoke anyone holding the public anon key could still insert
-- orders directly and skip those checks.
--
-- Only INSERT is revoked. SELECT/UPDATE for anon/authenticated stay as they
-- are (POS, CS and driver screens still read and update orders from the
-- browser). The production schema has no trigger or plain function inserting
-- into pickup_orders on behalf of anon. Idempotent.
--
-- Rollback (if a missed browser path appears): grant insert on table
-- public.pickup_orders to anon, authenticated;

revoke insert on table public.pickup_orders from anon, authenticated;
