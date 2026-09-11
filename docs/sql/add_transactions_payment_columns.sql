-- Kolom bayar yang dibutuhkan POS / Mayar QRIS.
-- Jalankan di Supabase SQL Editor (sekali), lalu coba lagi Bayar & Simpan.

alter table public.transactions
  add column if not exists payment_status text,
  add column if not exists payment_proof_url text,
  add column if not exists is_paid boolean default false,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_verified_by text,
  add column if not exists paid_via text,
  add column if not exists mayar_payment_id text,
  add column if not exists mayar_invoice_url text;

-- Opsional: refresh schema cache PostgREST (biasanya otomatis setelah ALTER)
notify pgrst, 'reload schema';
