-- Server code (service role) must be able to use the tables it works with.
--
-- Found with scripts/staging/service-role-needs.ts (server code scan vs the
-- production ACL in the schema dump) and confirmed read-only in production
-- (has_table_privilege('service_role', …) = false): 43 privileges the server
-- code uses are not granted to service_role. Production default privileges
-- for new tables give service_role only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN,
-- so tables created later (including the two customer-login tables of PR #5)
-- are unusable by the server until granted explicitly.
--
-- Effects in production today (all errors are swallowed by the app):
-- - Mayar deposit top-ups: deposit_topups / deposit_payment_credits /
--   membership_logs → pending top-ups are not recorded or credited;
-- - finance reconciliation, cash deposits, expenses, leakage alerts;
-- - webhook_logs (payment audit trail), error resolution (error_logs UPDATE);
-- - machines / washer monitor, loyalty and POS sync logs, order reviews;
-- - verified customer login (PR #5 tables).
--
-- Exactly the operations the server code performs, per table — no DELETE
-- (none used), no change for anon/authenticated. Plus USAGE on the sequences
-- behind nextval() defaults of the tables the server inserts into.
-- Idempotent.

grant SELECT, INSERT, UPDATE on table public.cash_deposits to service_role;
grant INSERT on table public.cashflow_logs to service_role;
grant SELECT, INSERT, UPDATE on table public.customer_auth_identities to service_role;
grant UPDATE on table public.customer_crm_profiles to service_role;
grant SELECT, INSERT, UPDATE on table public.customer_login_challenges to service_role;
grant SELECT, INSERT, UPDATE on table public.daily_reconciliations to service_role;
grant SELECT, INSERT on table public.deposit_payment_credits to service_role;
grant SELECT, INSERT, UPDATE on table public.deposit_topups to service_role;
grant UPDATE on table public.error_logs to service_role;
grant SELECT, INSERT on table public.expenses to service_role;
grant SELECT, INSERT, UPDATE on table public.financial_leakage_alerts to service_role;
grant INSERT on table public.inventory_logs to service_role;
grant INSERT on table public.loyalty_point_logs to service_role;
grant SELECT, INSERT on table public.membership_logs to service_role;
grant INSERT on table public.order_reviews to service_role;
grant SELECT, INSERT, UPDATE on table public.outlet_machines to service_role;
grant INSERT on table public.submissions to service_role;
grant INSERT on table public.unauthorized_wash_alerts to service_role;
grant SELECT, INSERT, UPDATE on table public.washer_cycle_logs to service_role;
grant SELECT, INSERT, UPDATE on table public.washers to service_role;
grant SELECT, INSERT on table public.webhook_logs to service_role;

do $$
declare
  seq text;
begin
  for seq in
    select distinct (regexp_match(c.column_default, 'nextval\(''([^'']+)''::regclass\)'))[1]
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('cash_deposits', 'cashflow_logs', 'customer_auth_identities', 'customer_login_challenges', 'daily_reconciliations', 'deposit_payment_credits', 'deposit_topups', 'expenses', 'financial_leakage_alerts', 'inventory_logs', 'loyalty_point_logs', 'membership_logs', 'order_reviews', 'outlet_machines', 'submissions', 'unauthorized_wash_alerts', 'washer_cycle_logs', 'washers', 'webhook_logs')
      and c.column_default like 'nextval(%'
  loop
    if seq is not null then
      execute format('grant usage on sequence %s to service_role', seq::regclass);
    end if;
  end loop;
end $$;
