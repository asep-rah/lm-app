-- Online customer orders are now created by the server
-- (/api/customer/order/create, service role) instead of the browser, and the
-- permissive policy on the log tables is removed.
--
-- 1. service_role (server-only key) may INSERT/SELECT pickup_orders and
--    system_tasks, plus USAGE on the sequences behind their nextval()
--    defaults (production: pickup_order_seq). Production ACL (confirmed
--    read-only): service_role had no privilege on system_tasks and no USAGE
--    on pickup_order_seq. anon/authenticated privileges are NOT changed here:
--    other screens (admin, delivery request) still write pickup_orders from
--    the browser; revoking anon INSERT is a separate, later step.
-- 2. Drop policy "allow full access for anon" (FOR ALL TO public) on
--    audit_logs and error_logs. Today anon has no table grant there, so the
--    policy is dormant — but any future grant would expose every log row to
--    the public anon key. service_role bypasses RLS; the existing
--    error_logs_select_authenticated policy is kept.
-- Idempotent.

grant select, insert on table public.pickup_orders to service_role;
grant select, insert on table public.system_tasks to service_role;

do $$
declare
  seq text;
begin
  for seq in
    select distinct (regexp_match(c.column_default, 'nextval\(''([^'']+)''::regclass\)'))[1]
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('pickup_orders', 'system_tasks')
      and c.column_default like 'nextval(%'
  loop
    if seq is not null then
      execute format('grant usage on sequence %s to service_role', seq::regclass);
    end if;
  end loop;
end $$;

drop policy if exists "allow full access for anon" on public.audit_logs;
drop policy if exists "allow full access for anon" on public.error_logs;
