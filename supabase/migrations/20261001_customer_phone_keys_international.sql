-- Foreign customer phone numbers (stored as +<country code><number>, see
-- lib/phone.ts) in the deposit functions.
--
-- customer_phone_keys() turns a phone into the forms it may be stored in so
-- decrement/credit deposit find the customer row. It only knew Indonesian
-- forms. For a foreign number that starts with 8 (Japan +81, Korea +82,
-- China +86, …) its "8… → 08…" rule produced an Indonesian look-alike
-- (+81 9012345678 → 0819012345678), so a deposit could hit the wrong
-- customer if both existed.
--
-- Now: a phone written with "+" and a country code other than 62 only
-- matches its own forms (+cc…, cc…). Every Indonesian input (08…, 62…, +62…,
-- 8…) gives exactly the same keys as before. Same signature, immutable,
-- CREATE OR REPLACE — idempotent; the callers (decrement/credit deposit) do
-- not change.
--
-- Rollback: re-run the customer_phone_keys definition from
-- 20260830_atomic_deposit.sql.

create or replace function customer_phone_keys(p_phone text)
returns text[]
language sql
immutable
as $$
  with d as (
    select
      regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits,
      left(trim(coalesce(p_phone, '')), 1) = '+' as plus
  )
  select case
    when d.plus and d.digits <> '' and d.digits not like '62%' then
      array_remove(array[
        nullif(trim(coalesce(p_phone, '')), ''),
        '+' || d.digits,
        d.digits
      ], null)
    else
      array_remove(array[
        nullif(trim(coalesce(p_phone, '')), ''),
        nullif(d.digits, ''),
        case when d.digits like '62%' and length(d.digits) > 4 then '0' || substring(d.digits from 3) end,
        case when d.digits like '0%' and length(d.digits) > 4 then '62' || substring(d.digits from 2) end,
        case when d.digits like '8%' and length(d.digits) between 9 and 13 then '0' || d.digits end
      ], null)
  end
  from d;
$$;
