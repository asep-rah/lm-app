-- Kolom pelapor kasir: aplikasi menulis created_by_name + reporter_name.
alter table outlet_issues
  add column if not exists created_by_name text,
  add column if not exists title text;

-- Realtime inbox Supervisor: perubahan harus terbit ke klien.
alter table outlet_issues replica identity full;
alter table system_tasks replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table outlet_issues;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table system_tasks;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
