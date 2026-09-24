-- Server log tables must be writable by service_role (server-only key).
--
-- Found on staging (restored from the production schema dump, which carries
-- the production ACL): service_role has no privileges on public.audit_logs
-- and public.error_logs, so insertAuditLog / insertErrorLog (service role)
-- fail with 42501 and nothing is logged. PR #5 depends on this:
-- - every staff view of a satuan item photo must be written to audit_logs;
-- - /api/customer/order/report-error counts and writes error_logs.
--
-- Only SELECT and INSERT (no UPDATE/DELETE: logs stay append-only for the
-- server), plus USAGE on the sequences behind their nextval() defaults.
-- anon/authenticated privileges are not changed. Idempotent.
--
-- REVIEW BEFORE PRODUCTION: confirm in production first (read-only):
--   select c.relname, has_table_privilege('service_role', c.oid, 'INSERT') as svc_insert
--   from pg_class c where c.oid in ('public.audit_logs'::regclass, 'public.error_logs'::regclass);

grant select, insert on table public.audit_logs to service_role;
grant select, insert on table public.error_logs to service_role;

do $$
declare
  seq text;
begin
  for seq in
    select (regexp_match(c.column_default, 'nextval\(''([^'']+)''::regclass\)'))[1]
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('audit_logs', 'error_logs')
      and c.column_default like 'nextval(%'
  loop
    if seq is not null then
      execute format('grant usage on sequence %s to service_role', seq::regclass);
    end if;
  end loop;
end $$;
