-- ============================================================================
-- Alur Pengajuan Pembelian Outlet (Purchase Requisition) + tabel pendukung KPI.
--
-- Alur status:
--   'Pending Approval'               karyawan outlet mengajukan
--   'Approved - Awaiting Admin Ops'  supervisor menyetujui
--   'Rejected'                       supervisor menolak (final)
--   'Completed'                      admin ops membayar; otomatis insert expenses
--
-- CATATAN TIPE outlet_id: diasumsikan outlets.id bertipe uuid (konsisten dengan
-- pemakaian di aplikasi). Jika ternyata bigint, migrasi ini akan GAGAL dengan
-- pesan jelas di baris foreign key -- ganti `uuid` menjadi `bigint` lalu jalankan
-- ulang. Gagal saat migrasi jauh lebih baik daripada insert yang ditolak diam-diam
-- pada saat aplikasi berjalan.
-- ============================================================================

create table if not exists purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  outlet_id        uuid references outlets(id) on delete set null,

  requester_name   text not null,
  -- items: [{ "name": "Deterjen 5L", "qty": 2, "unit": "galon", "est_price": 75000 }]
  items            jsonb   default '[]'::jsonb,
  estimated_cost   numeric default 0,
  category         text    default 'Lain-lain',
  notes            text,
  quote_url        text,

  status           text not null default 'Pending Approval',

  -- Jejak persetujuan supervisor
  approved_by      text,
  approved_at      timestamptz,
  rejected_by      text,
  rejected_at      timestamptz,
  rejection_reason text,

  -- Jejak eksekusi admin ops
  paid_by            text,
  paid_at            timestamptz,
  payment_proof_url  text,
  actual_cost        numeric,
  expense_id         uuid,

  created_at       timestamptz default now()
);

-- Menyusul bila tabel sudah pernah dibuat versi lebih awal.
alter table purchase_requests
  add column if not exists category          text default 'Lain-lain',
  add column if not exists quote_url         text,
  add column if not exists rejection_reason  text,
  add column if not exists payment_proof_url text,
  add column if not exists actual_cost       numeric,
  add column if not exists expense_id        uuid;

create index if not exists idx_purchase_requests_status on purchase_requests (status);
create index if not exists idx_purchase_requests_outlet on purchase_requests (outlet_id);
create index if not exists idx_purchase_requests_created on purchase_requests (created_at desc);

-- ---------------------------------------------------------------------------
-- expenses: kolom penghubung agar biaya hasil pengajuan bisa dilacak balik.
-- ---------------------------------------------------------------------------
alter table expenses
  add column if not exists status         text,
  add column if not exists proof_url      text,
  add column if not exists requisition_id uuid,
  add column if not exists notes          text,
  add column if not exists description    text,
  add column if not exists created_by      text;

create index if not exists idx_expenses_requisition on expenses (requisition_id);

-- ---------------------------------------------------------------------------
-- system_tasks: dipakai HeadTaskDelegator, utils/taskSlaEvaluator, dan
-- pembuatan task otomatis dari laporan kendala outlet.
-- ---------------------------------------------------------------------------
create table if not exists system_tasks (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  description        text,
  assigned_to_role   text not null default 'supervisor',
  sla_hours          integer default 24,
  due_date           timestamptz,
  kpi_penalty_points integer default 10,
  created_by_name    text,
  status             text default 'PENDING',
  completed_at       timestamptz,
  -- Asal task otomatis, mis. source_type='OUTLET_ISSUE' + id laporannya.
  source_type        text,
  source_id          uuid,
  created_at         timestamptz default now()
);

alter table system_tasks
  add column if not exists status      text default 'PENDING',
  add column if not exists completed_at timestamptz,
  add column if not exists source_type text,
  add column if not exists source_id   uuid,
  add column if not exists created_at  timestamptz default now();

create index if not exists idx_system_tasks_role   on system_tasks (assigned_to_role);
create index if not exists idx_system_tasks_status on system_tasks (status);
create index if not exists idx_system_tasks_source on system_tasks (source_type, source_id);

-- ---------------------------------------------------------------------------
-- kpi_logs: poin reward/penalti SLA (dipakai utils/taskSlaEvaluator).
-- ---------------------------------------------------------------------------
create table if not exists kpi_logs (
  id            uuid primary key default gen_random_uuid(),
  employee_id   text,
  employee_name text,
  role          text,
  source_type   text,
  score_change  numeric default 0,
  reason        text,
  created_at    timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- outlet_issues: kolom yang sudah dipakai kode tapi belum tentu ada di schema.
-- ---------------------------------------------------------------------------
create table if not exists outlet_issues (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid references outlets(id) on delete set null,
  category      text,
  description   text,
  reporter_name text,
  status        text default 'Perlu Penanganan',
  created_at    timestamptz default now()
);

alter table outlet_issues
  add column if not exists urgency     text default 'Normal',
  add column if not exists media_url   text,
  add column if not exists resolved_at timestamptz,
  add column if not exists task_id     uuid;

create index if not exists idx_outlet_issues_status on outlet_issues (status);

-- ---------------------------------------------------------------------------
-- Hak akses: aplikasi memakai publishable/anon key dari sisi klien, sama seperti
-- tabel-tabel lama. Grant eksplisit supaya tabel baru tidak tertolak PostgREST.
-- ---------------------------------------------------------------------------
grant all on purchase_requests to anon, authenticated;
grant all on system_tasks      to anon, authenticated;
grant all on kpi_logs          to anon, authenticated;
grant all on outlet_issues     to anon, authenticated;
