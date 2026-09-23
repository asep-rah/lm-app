-- Mandatory photo per satuan (per-item) order line.
--
-- Bucket is PRIVATE (public = false) — unlike outlet-photos/promo-banners,
-- there is no getPublicUrl()/permanent public link for these photos. Staff
-- view them through a short-lived signed URL (see
-- lib/satuanItemPhoto.ts signedSatuanItemPhotoUrl, ~1h TTL), generated on
-- demand ("Lihat foto" button — deferred, not auto-loaded), matching the
-- performance rule in docs/SECURITY_AND_MAINTENANCE.md §4.
--
-- Known limitation (documented, not fixed by this migration): the customer
-- app and staff portals (POS/CS) currently all use the SAME anon Supabase
-- key — there is no Supabase Auth for staff yet (see
-- docs/SECURITY_AND_MAINTENANCE.md §6 "RLS penuh ... butuh Supabase Auth
-- staf"). createSignedUrl() requires a SELECT policy, so this migration
-- grants anon both insert (upload) and select (needed to sign) on this
-- bucket only — it cannot be restricted to "staff only" without that staff
-- Auth work, which is out of scope here. What this DOES achieve: the photo
-- is never a bare, permanent, cacheable public URL — reading it requires the
-- app's API key plus a signing round-trip that expires.

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('satuan-item-photos', 'satuan-item-photos', false)
  on conflict (id) do nothing;
exception
  when undefined_table then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'satuan_item_photos_write'
  ) then
    create policy satuan_item_photos_write on storage.objects
      for insert with check (bucket_id = 'satuan-item-photos');
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'satuan_item_photos_read'
  ) then
    create policy satuan_item_photos_read on storage.objects
      for select using (bucket_id = 'satuan-item-photos');
  end if;
exception
  when undefined_table then null;
  when insufficient_privilege then null;
  when duplicate_object then null;
end $$;
