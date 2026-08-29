-- 4-tier complaint workflow: unboxing video → CS Care → Supervisor → customer agree/appeal.
alter table outlet_issues
  add column if not exists unboxing_video_url text,
  add column if not exists findings text,
  add column if not exists cctv_notes text,
  add column if not exists supervisor_decision text,
  add column if not exists supervisor_note text,
  add column if not exists workflow_step text,
  add column if not exists customer_decision text;
