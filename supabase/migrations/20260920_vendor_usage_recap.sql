-- ============================================================================
-- Rekap pemakaian vendor untuk penagihan (Admin Operasional).
--
-- Contoh vendor: Lalamove (kurir pihak ketiga), mCoin Smartlink, dan vendor
-- lain yang menagih per periode.
--
-- Sumber data bisa tiga macam:
--   'internal' -> disalin dari data yang sudah ada di sistem, mis.
--                 third_party_deliveries untuk Lalamove
--   'n8n'      -> diimpor otomatis lewat /api/integrations/n8n/vendor-usage
--   'manual'   -> diketik Admin Ops untuk vendor yang belum terintegrasi
--
-- Tabel ini murni pencatatan pemakaian untuk ditagihkan; TIDAK menulis ke
-- expenses dan tidak menyentuh domain finance.
-- ============================================================================

create table if not exists vendor_accounts (
  id            uuid primary key default gen_random_uuid(),
  vendor_key    text unique not null,          -- 'lalamove' | 'mcoin_smartlink' | ...
  label         text not null,
  billing_cycle text default 'monthly',        -- monthly | weekly
  notes         text,
  is_active     boolean default true,
  created_at    timestamptz default now()
);

create table if not exists vendor_usage_entries (
  id             uuid primary key default gen_random_uuid(),
  vendor_key     text not null,
  outlet_id      uuid references outlets(id) on delete set null,

  usage_date     date not null,
  reference      text,                          -- no. order / resi dari vendor
  amount         numeric default 0,
  qty            numeric default 1,

  source         text default 'manual',         -- manual | n8n | internal
  -- Kunci idempotensi impor: id milik vendor / id baris asal di sistem.
  external_id    text,
  meta           jsonb default '{}'::jsonb,

  billing_period text,                          -- '2026-09'
  billed_at      timestamptz,
  billed_by      text,

  created_by     text,
  created_at     timestamptz default now()
);

-- Impor yang diulang (retry n8n, sinkronisasi berkala) tidak boleh menggandakan
-- tagihan.
--
-- Indeks ini SENGAJA tidak parsial. NULL dianggap berbeda satu sama lain di
-- indeks unik Postgres, jadi entri manual tanpa external_id tetap boleh berulang
-- tanpa perlu klausa WHERE. Versi parsial akan membuat `on conflict
-- (vendor_key, external_id) do nothing` -- yang dipakai impor n8n -- gagal
-- karena indeksnya tidak bisa disimpulkan.
create unique index if not exists vendor_usage_external_uniq
  on vendor_usage_entries (vendor_key, external_id);

create index if not exists idx_vendor_usage_period
  on vendor_usage_entries (vendor_key, billing_period);
create index if not exists idx_vendor_usage_date
  on vendor_usage_entries (usage_date desc);
create index if not exists idx_vendor_usage_outlet
  on vendor_usage_entries (outlet_id, usage_date desc);

-- Vendor yang sudah pasti dipakai. ON CONFLICT supaya migrasi aman diulang.
insert into vendor_accounts (vendor_key, label, billing_cycle) values
  ('lalamove',        'Lalamove',        'monthly'),
  ('mcoin_smartlink', 'mCoin Smartlink', 'monthly')
on conflict (vendor_key) do nothing;

grant all on vendor_accounts      to anon, authenticated;
grant all on vendor_usage_entries to anon, authenticated;
