-- Keamanan tahap 2a: status bayar & void transaksi hanya diubah server.
--
-- Sebelumnya siapa pun dengan kunci anon (ada di browser) bisa mengubah
-- transaksi menjadi LUNAS (is_paid / payment_status / paid_at) atau me-void
-- transaksi. Sekarang:
--   * lunas: webhook Mayar, cek status, cron, /api/pay/mark-manual (sesi staf)
--   * void : /api/owner/void-transaction (owner)
-- memakai service role. Browser (anon/authenticated):
--   * UPDATE: tidak bisa mengubah transaksi belum lunas → lunas, tidak bisa
--     mengubah paid_at / paid_via / paid_verified_by, tidak bisa me-void.
--     Perubahan operasional lain (status proses, foto, rak, berat, nominal
--     sebelum tutup buku, permintaan hapus) tetap boleh.
--   * INSERT: transaksi QRIS/transfer selalu mulai BELUM lunas (seperti POS);
--     tidak bisa langsung dibuat void.
-- Kolom dibaca lewat to_jsonb agar aman walau sebagian kolom tidak ada.
--
-- URUTAN: deploy versi aplikasi ini DULU (webhook & CS memakai service role),
-- baru jalankan SQL ini. Tidak mengubah data. Idempotent.
-- Rollback: drop trigger if exists transactions_guard_payment on public.transactions;

grant select, insert, update on table public.transactions to service_role;
grant select, update on table public.system_tasks to service_role;
grant select, update on table public.pickup_orders to service_role;
grant select, delete on table public.cashflow_logs to service_role;
grant select, delete on table public.delete_requests to service_role;

create or replace function public.transactions_guard_payment()
returns trigger
language plpgsql
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  paid_words text[] := array['paid', 'lunas', 'verified'];
  method text := lower(coalesce(n->>'payment_method', ''));
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (n->>'is_void') = 'true' or coalesce(n->>'voided_at', '') <> '' then
      raise exception 'Transaksi baru tidak boleh langsung dibatalkan.' using errcode = '42501';
    end if;
    -- Non-tunai (QRIS/transfer, termasuk split yang memuatnya) harus diverifikasi dulu.
    if (method like '%qris%' or method like '%transfer%')
      and ((n->>'is_paid') = 'true'
        or lower(coalesce(n->>'payment_status', '')) = any (paid_words)
        or coalesce(n->>'paid_at', '') <> '') then
      raise exception 'Pembayaran QRIS/transfer hanya bisa dinyatakan lunas oleh server.' using errcode = '42501';
    end if;
    return new;
  end if;

  o := to_jsonb(old);
  if ((n->>'is_paid') = 'true' and coalesce(o->>'is_paid', 'false') <> 'true')
    or (lower(coalesce(n->>'payment_status', '')) = any (paid_words)
        and not (lower(coalesce(o->>'payment_status', '')) = any (paid_words)))
    or ((lower(coalesce(n->>'status', '')) = 'paid' or lower(coalesce(n->>'status', '')) like '%lunas%')
        and not (lower(coalesce(o->>'status', '')) = 'paid' or lower(coalesce(o->>'status', '')) like '%lunas%'))
    or (n->'paid_at') is distinct from (o->'paid_at')
    or (n->'paid_via') is distinct from (o->'paid_via')
    or (n->'paid_verified_by') is distinct from (o->'paid_verified_by') then
    raise exception 'Status pembayaran hanya bisa diubah lewat verifikasi server.' using errcode = '42501';
  end if;
  if ((n->>'is_void') = 'true' and coalesce(o->>'is_void', 'false') <> 'true')
    or (n->'voided_at') is distinct from (o->'voided_at')
    or (n->'voided_by') is distinct from (o->'voided_by') then
    raise exception 'Void transaksi hanya lewat persetujuan owner.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_guard_payment on public.transactions;
create trigger transactions_guard_payment
  before insert or update on public.transactions
  for each row execute function public.transactions_guard_payment();

notify pgrst, 'reload schema';
