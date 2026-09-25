-- Driver pin correction (/api/staff/pickup-pin).
--
-- The assigned driver, standing at the customer's gate, saves the phone GPS
-- as the pickup point. The server (service_role) updates ONLY the
-- coordinates of that pickup order and of the customer's saved address the
-- order came from. Role check (driver, re-read from employees), "same
-- customer" check and audit (audit_logs action pickup_pin_corrected, with the
-- old and new point) are in the API.
--
-- Production ACL: service_role had SELECT/INSERT on pickup_orders only
-- (20260926) and no confirmed grant on customer_addresses. Column-level
-- grants keep the service role away from every other column.
-- No data change, no backfill. Idempotent.
-- Rollback:
--   revoke update (latitude, longitude) on public.pickup_orders from service_role;
--   revoke update (latitude, longitude) on public.customer_addresses from service_role;

grant update (latitude, longitude) on table public.pickup_orders to service_role;

grant select on table public.customer_addresses to service_role;
grant update (latitude, longitude) on table public.customer_addresses to service_role;

grant select on table public.outlets to service_role;

notify pgrst, 'reload schema';
