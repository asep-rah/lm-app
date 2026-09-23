-- Fix: "null value in column pickup_date ... violates not-null constraint".
--
-- pickup_orders.pickup_date has carried a NOT NULL constraint from an earlier
-- schema (predates supabase/migrations; not reflected in this repo's migration
-- files, which only ever ran `add column if not exists pickup_date date`
-- without NOT NULL). That silently broke "Jemput sekarang" (instant pickup)
-- orders, whose payload never populated pickup_date, as well as
-- lib/pickupDispatch.ts's requestDriverDelivery() fallback insert and the
-- legacy app/admin/page.tsx order form, neither of which set pickup_date.
--
-- pickup_date/pickup_time/scheduled_at/pickup_at only carry meaning for a
-- SCHEDULED pickup (see lib/customerActivity.ts isScheduledOrder /
-- scheduleAtOf); an instant order legitimately has no customer-chosen date,
-- so the column must be nullable. The customer app now also writes today's
-- local date into pickup_date for instant orders (informational only — it
-- does not affect scheduling classification, which additionally requires
-- pickup_time/scheduled_at/pickup_at or an explicit "Jadwal jemput:" note).
--
-- Safe / non-destructive: only loosens a constraint, no data changes, no
-- backfill needed (existing rows already satisfy NOT NULL).
-- Rollback: alter table pickup_orders alter column pickup_date set not null;
--   (only safe to rollback if every row has a non-null pickup_date again).

do $$
begin
  alter table pickup_orders alter column pickup_date drop not null;
exception
  when undefined_table then null;
  when undefined_column then null;
end $$;

notify pgrst, 'reload schema';
