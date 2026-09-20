-- ============================================================================
-- Digital Marketing & Owner Relation.
--
-- Dua tim ini belum punya modul sama sekali: pengajuan Google Ads / desain /
-- pendaftaran outlet ke website masih lewat percakapan, dan laporan investor
-- serta jadwal meeting belum tercatat.
--
-- Semua tabel di sini berdiri sendiri. Laporan investor MEMBACA angka keuangan
-- dari lib/financeStatements.ts; tidak ada rumus keuangan baru dan tidak ada
-- penulisan ke domain finance.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pengajuan ke tim Digital Marketing
-- ---------------------------------------------------------------------------
create table if not exists marketing_requests (
  id                uuid primary key default gen_random_uuid(),
  -- google_ads | design | website_outlet | gbp_optimization
  type              text not null,
  outlet_id         uuid references outlets(id) on delete set null,

  requested_by_name text,
  requested_by_role text,
  brief             text,
  budget            numeric,
  target_date       date,
  assets            jsonb default '[]'::jsonb,

  -- submitted | in_progress | waiting_approval | done | rejected
  status            text default 'submitted',
  handled_by_name   text,
  result_note       text,
  result_url        text,
  -- Tautan ke system_tasks supaya SLA & poin KPI ikut terhitung
  task_id           uuid,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_marketing_requests_status
  on marketing_requests (status, created_at desc);
create index if not exists idx_marketing_requests_outlet
  on marketing_requests (outlet_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Riwayat rating & review Google Bisnis per outlet.
--
-- Kolom outlets.google_rating / google_review_count menyimpan kondisi TERKINI.
-- Tabel ini menyimpan riwayatnya supaya penurunan rating bisa terlihat, bukan
-- hanya angka hari ini. Diisi impor n8n (lihat Fase 4).
-- ---------------------------------------------------------------------------
create table if not exists outlet_google_snapshots (
  id               uuid primary key default gen_random_uuid(),
  outlet_id        uuid references outlets(id) on delete cascade,
  captured_at      timestamptz default now(),
  rating           double precision,
  review_count     integer,
  new_reviews      jsonb default '[]'::jsonb,
  unreplied_count  integer default 0,
  source           text default 'n8n',
  -- Kunci idempotensi impor: satu snapshot per outlet per hari.
  snapshot_date    date default current_date
);

create unique index if not exists outlet_google_snapshot_daily_uniq
  on outlet_google_snapshots (outlet_id, snapshot_date);
create index if not exists idx_google_snapshots_outlet
  on outlet_google_snapshots (outlet_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Laporan investor & jadwal meeting (Owner Relation)
-- ---------------------------------------------------------------------------
create table if not exists investor_reports (
  id              uuid primary key default gen_random_uuid(),
  period_start    date,
  period_end      date,
  -- '2026-Q3'
  quarter         text,
  title           text,
  summary         text,
  -- Angka hasil bacaan dari laporan keuangan, dibekukan saat laporan dibuat
  metrics         jsonb default '{}'::jsonb,
  attachments     jsonb default '[]'::jsonb,
  status          text default 'draft',        -- draft | sent
  sent_at         timestamptz,
  created_by_name text,
  created_at      timestamptz default now()
);

create index if not exists idx_investor_reports_quarter
  on investor_reports (quarter, created_at desc);

create table if not exists investor_meetings (
  id            uuid primary key default gen_random_uuid(),
  scheduled_at  timestamptz not null,
  quarter       text,
  agenda        text,
  location      text,
  attendees     jsonb default '[]'::jsonb,
  report_id     uuid references investor_reports(id) on delete set null,
  minutes       text,
  status        text default 'scheduled',       -- scheduled | done | cancelled
  created_by_name text,
  created_at    timestamptz default now()
);

create index if not exists idx_investor_meetings_time
  on investor_meetings (scheduled_at desc);

grant all on marketing_requests       to anon, authenticated;
grant all on outlet_google_snapshots  to anon, authenticated;
grant all on investor_reports         to anon, authenticated;
grant all on investor_meetings        to anon, authenticated;
