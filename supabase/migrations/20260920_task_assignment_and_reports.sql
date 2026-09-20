-- ============================================================================
-- Fondasi workspace tim internal.
--
-- 1. system_tasks bisa ditugaskan ke ORANG tertentu, bukan hanya ke role.
--    Kolom lama assigned_to_role TIDAK diubah -- inbox per-role tetap jalan
--    dan semua pembuat task otomatis yang ada (komplain, rekonsiliasi,
--    verifikasi pembayaran) tidak perlu disentuh.
-- 2. Penyelesaian task bisa melampirkan laporan (catatan + berkas).
-- 3. task_comments: utas diskusi per task antar tim.
-- ============================================================================

alter table system_tasks
  -- employees.id bertipe uuid; dibiarkan tanpa foreign key karena sebagian
  -- task dibuat oleh proses otomatis yang tidak punya employee id.
  add column if not exists assigned_to_employee_id uuid,
  add column if not exists assigned_to_name        text,
  -- [{ "url": "...", "name": "...", "type": "image/jpeg" }]
  add column if not exists attachments             jsonb default '[]'::jsonb,
  add column if not exists report_note             text,
  -- null | 'daily' | 'weekly' | 'monthly'
  add column if not exists recurrence              text;

create index if not exists idx_system_tasks_employee
  on system_tasks (assigned_to_employee_id)
  where assigned_to_employee_id is not null;

-- ---------------------------------------------------------------------------
-- Diskusi per task. Lampiran memakai bentuk yang sama dengan system_tasks.
-- ---------------------------------------------------------------------------
create table if not exists task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null,
  author_id   uuid,
  author_name text,
  author_role text,
  body        text,
  attachments jsonb default '[]'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists idx_task_comments_task
  on task_comments (task_id, created_at);

grant all on task_comments to anon, authenticated;
