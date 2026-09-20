-- ============================================================================
-- Laporan supervisi outlet.
--
-- Supervisor mengunjungi outlet lalu mengisi: checklist kondisi, catatan omset
-- beserta rencana perbaikannya, catatan karyawan, dan temuan kendala.
-- Temuan yang perlu ditindaklanjuti melahirkan system_tasks, memakai jalur yang
-- sama dengan laporan kendala outlet (lib/createOutletIssueTask.ts).
--
-- Tabel ini berdiri sendiri: tidak menyentuh transactions/expenses/payment.
-- ============================================================================

create table if not exists supervision_visits (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid references outlets(id) on delete set null,

  supervisor_id   uuid,
  supervisor_name text,

  visit_date      date not null default current_date,

  -- { "kebersihan": "ok" | "perlu_perbaikan" | "buruk", ... }
  -- Kunci checklist didefinisikan di lib/supervisionVisit.ts, bukan di sini,
  -- supaya penambahan poin checklist tidak butuh migrasi.
  checklist       jsonb default '{}'::jsonb,
  score           numeric,

  omset_note        text,
  omset_action_plan text,
  staff_note        text,

  -- [{ "category": "Mesin", "description": "...", "urgency": "Mendesak" }]
  issues_found    jsonb default '[]'::jsonb,
  -- [{ "url": "...", "name": "...", "type": "image/jpeg" }]
  photos          jsonb default '[]'::jsonb,

  follow_up_task_id uuid,

  -- draft | submitted | reviewed
  status          text default 'draft',
  submitted_at    timestamptz,
  reviewed_by     text,
  reviewed_at     timestamptz,
  review_note     text,

  created_at      timestamptz default now()
);

-- Daftar kunjungan selalu dibaca per outlet dan per periode; tanpa indeks ini
-- halaman supervisi akan memindai seluruh tabel begitu outlet bertambah.
create index if not exists idx_supervision_visits_outlet
  on supervision_visits (outlet_id, visit_date desc);
create index if not exists idx_supervision_visits_date
  on supervision_visits (visit_date desc);
create index if not exists idx_supervision_visits_supervisor
  on supervision_visits (supervisor_id, visit_date desc);

grant all on supervision_visits to anon, authenticated;
