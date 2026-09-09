-- Pembukuan awal outlet: modal, kas, hutang, aset, setoran, prive.
-- Jalankan di Supabase SQL Editor. Aplikasi tetap jalan via outlet_overrides.__outlet_books
-- jika kolom ini belum ada.

alter table public.app_settings
  add column if not exists outlet_books jsonb default '{}'::jsonb;
