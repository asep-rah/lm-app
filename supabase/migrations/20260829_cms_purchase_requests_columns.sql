-- Selaraskan purchase_requests dengan kolom CMS yang sudah dipakai aplikasi pusat.
-- Kolom lama (requester_name, estimated_cost, notes, quote_url, approved_at, paid_at)
-- dibiarkan bila ada; backfill hanya dijalankan jika kolom sumber memang ada.

alter table purchase_requests
  add column if not exists requested_by           text,
  add column if not exists title                  text,
  add column if not exists amount                 numeric,
  add column if not exists description            text,
  add column if not exists receipt_url            text,
  add column if not exists proof_url              text,
  add column if not exists supervisor_approved_at timestamptz,
  add column if not exists admin_paid_at          timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requests' and column_name = 'requester_name'
  ) then
    update purchase_requests
      set requested_by = coalesce(requested_by, requester_name)
      where requested_by is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requests' and column_name = 'estimated_cost'
  ) then
    update purchase_requests
      set amount = coalesce(amount, estimated_cost, actual_cost)
      where amount is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requests' and column_name = 'notes'
  ) then
    update purchase_requests
      set description = coalesce(description, notes)
      where description is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requests' and column_name = 'quote_url'
  ) then
    update purchase_requests
      set receipt_url = coalesce(receipt_url, quote_url)
      where receipt_url is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requests' and column_name = 'approved_at'
  ) then
    update purchase_requests
      set supervisor_approved_at = coalesce(supervisor_approved_at, approved_at)
      where supervisor_approved_at is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_requests' and column_name = 'paid_at'
  ) then
    update purchase_requests
      set admin_paid_at = coalesce(admin_paid_at, paid_at)
      where admin_paid_at is null;
  end if;
end $$;

-- Status akhir CMS adalah 'Paid', bukan 'Completed'.
update purchase_requests
  set status = 'Paid'
  where status in ('Completed', 'PAID', 'Paid / Transferred');
