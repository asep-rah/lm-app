-- Harden payment security logs: deny public/anon; service role bypasses RLS.
-- Jalankan di Supabase SQL Editor setelah 20260908_payment_security_logs.sql

alter table public.webhook_logs enable row level security;
alter table public.error_logs enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.webhook_logs from anon, authenticated;
revoke all on public.error_logs from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;

-- Service role (backend) tetap full access via bypass RLS.
-- Owner UI membaca error_logs lewat anon client — beri policy baca terbatas untuk authenticated/owner via staff session tidak ada JWT.
-- Solusi aman: hanya service role + API route. Untuk owner system-health yang pakai supabase anon,
-- izinkan SELECT pada error_logs/webhook_logs hanya jika policy "authenticated" — bila app masih anon key:
-- grant SELECT terbatas ke authenticated; anon TIDAK.

drop policy if exists webhook_logs_deny_all on public.webhook_logs;
drop policy if exists error_logs_deny_all on public.error_logs;
drop policy if exists audit_logs_deny_all on public.audit_logs;
drop policy if exists error_logs_select_authenticated on public.error_logs;
drop policy if exists webhook_logs_select_authenticated on public.webhook_logs;

-- Default deny: tidak ada policy = tidak ada akses untuk anon/authenticated saat RLS on
-- (service_role bypasses RLS).

-- Optional: jika staff login Supabase Auth (authenticated), boleh baca log diagnosis.
create policy error_logs_select_authenticated
  on public.error_logs for select
  to authenticated
  using (true);

create policy webhook_logs_select_authenticated
  on public.webhook_logs for select
  to authenticated
  using (true);

-- audit_logs: tidak dibuka ke client; hanya service role / SQL.

grant select on public.error_logs to authenticated;
grant select on public.webhook_logs to authenticated;

comment on table public.audit_logs is 'Hanya service role. Jangan grant ke anon.';
comment on table public.error_logs is 'SELECT authenticated saja; tulis via service role API.';
comment on table public.webhook_logs is 'SELECT authenticated saja; tulis via service role API.';
