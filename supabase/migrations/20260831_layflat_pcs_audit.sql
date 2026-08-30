-- Optional intake/output pcs + first-photo columns for lay-flat Sortir/Kemas.
-- Arrays of burst photos stay in transactions.items JSON.

alter table public.transactions add column if not exists intake_pcs numeric;
alter table public.transactions add column if not exists output_pcs numeric;
alter table public.transactions add column if not exists total_pcs numeric;
alter table public.transactions add column if not exists sortir_photo_url text;
alter table public.transactions add column if not exists packing_photo_url text;

notify pgrst, 'reload schema';
