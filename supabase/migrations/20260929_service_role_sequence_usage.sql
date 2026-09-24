-- USAGE on every sequence used in a column DEFAULT of a table service_role
-- may INSERT into.
--
-- 20260925–20260927 granted USAGE only for defaults that START with
-- nextval('…'). Staging (production schema) showed a sequence used inside a
-- larger default expression (pickup_orders: pickup_order_seq), so a server
-- insert that relies on that default failed with "permission denied for
-- sequence pickup_order_seq". This covers every nextval() anywhere in a
-- default, for tables where service_role already has INSERT. Only USAGE
-- (nextval/currval), no other sequence privilege; nothing for anon.
-- Idempotent.

do $$
declare
  seq text;
begin
  for seq in
    select distinct m[1]
    from information_schema.columns c
    cross join lateral regexp_matches(c.column_default, 'nextval\(''([^'']+)''(?:::regclass)?\)', 'g') as m
    where c.table_schema = 'public'
      and c.column_default like '%nextval(%'
      and has_table_privilege('service_role', format('%I.%I', c.table_schema, c.table_name), 'INSERT')
  loop
    execute format('grant usage on sequence %s to service_role', seq::regclass);
  end loop;
end $$;
