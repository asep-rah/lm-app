-- Mayar.id QRIS: per-outlet credentials + payment refs on transactions.
alter table outlets
  add column if not exists mayar_api_key text,
  add column if not exists mayar_payout_account_id text;

alter table transactions
  add column if not exists mayar_payment_id text,
  add column if not exists mayar_invoice_url text;
