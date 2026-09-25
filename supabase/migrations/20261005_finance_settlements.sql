-- Pembayaran utang yang dicatat owner di laporan keuangan:
--   kind = 'profit_share'  pembayaran bagi hasil pengelolaan (mengurangi 210010)
--   kind = 'thr'           pembayaran THR crew saat hari raya (mengurangi 210011,
--                          biasanya dari Dana Tabungan THR 110006)
-- Ditulis hanya lewat /api/owner/finance-settlements (sesi staf, role owner
-- dibaca ulang dari employees, tercatat di audit_logs). Tidak ada hapus:
-- salah catat dibatalkan (voided_at), jejaknya tetap.
--
-- anon/authenticated tidak punya akses sama sekali (RLS on, tanpa policy).
-- No backfill. Idempotent.
-- Rollback: drop table public.finance_settlements;  (hanya bila belum dipakai)

create table if not exists public.finance_settlements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null,
  kind text not null check (kind in ('profit_share', 'thr')),
  amount numeric(14, 2) not null check (amount > 0),
  paid_at date not null,
  source text not null check (source in ('bank', 'laci', 'dana_thr')),
  note text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text,
  void_reason text
);

create index if not exists finance_settlements_outlet_paid_idx on public.finance_settlements (outlet_id, paid_at);

alter table public.finance_settlements enable row level security;
revoke all on table public.finance_settlements from anon, authenticated;
grant select, insert on table public.finance_settlements to service_role;
grant update (voided_at, voided_by, void_reason) on table public.finance_settlements to service_role;

notify pgrst, 'reload schema';
