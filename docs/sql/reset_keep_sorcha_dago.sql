-- =============================================================================
-- reset_keep_sorcha_dago.sql
-- Opsi A: hapus semua histori operasional/percobaan, sisakan outlet Sorcha Dago.
--
-- WAJIB:
--   1) Backup / snapshot Supabase dulu.
--   2) Jalankan di Supabase SQL Editor sebagai postgres / service role
--      (bukan anon — hard-delete transaksi di-REVOKE untuk anon/authenticated
--       lewat 20260910_money_guardrails.sql).
--   3) Konfirmasi resolve outlet = 1 baris sebelum COMMIT.
--
-- Idempoten: aman dijalankan ulang setelah state sudah bersih (no-op wipe,
-- tetap 1 outlet).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Resolve outlet yang dipertahankan
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  keep_id uuid;
  keep_name text;
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.outlets
  WHERE name ILIKE '%sorcha%dago%';

  IF n = 0 THEN
    RAISE EXCEPTION 'Outlet Sorcha Dago tidak ditemukan. Cek: SELECT id, name FROM outlets;';
  END IF;
  IF n > 1 THEN
    RAISE EXCEPTION 'Lebih dari 1 outlet cocok ILIKE %%sorcha%%dago%% (%). Resolve manual dulu.', n;
  END IF;

  SELECT id, name INTO keep_id, keep_name
  FROM public.outlets
  WHERE name ILIKE '%sorcha%dago%'
  LIMIT 1;

  RAISE NOTICE 'KEEP outlet: % (%)', keep_name, keep_id;

  -- Simpan ke temp table agar step berikutnya bisa pakai
  CREATE TEMP TABLE IF NOT EXISTS _reset_keep (
    outlet_id uuid PRIMARY KEY,
    outlet_name text
  ) ON COMMIT DROP;

  DELETE FROM _reset_keep;
  INSERT INTO _reset_keep (outlet_id, outlet_name) VALUES (keep_id, keep_name);
END $$;

-- -----------------------------------------------------------------------------
-- 2) Hapus histori operasional (anak → induk; tabel opsional di-skip aman)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.safe_delete(tbl text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(tbl) IS NULL THEN
    RAISE NOTICE 'skip (no table): %', tbl;
    RETURN;
  END IF;
  EXECUTE format('DELETE FROM %s', tbl);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skip (privilege): %', tbl;
  WHEN others THEN
    RAISE NOTICE 'skip % (%)', tbl, SQLERRM;
END;
$$;

-- Chat / complaint / review
SELECT pg_temp.safe_delete('public.complaint_chat_messages');
SELECT pg_temp.safe_delete('public.complaint_tickets');
SELECT pg_temp.safe_delete('public.order_reviews');
SELECT pg_temp.safe_delete('public.support_chat_messages');
SELECT pg_temp.safe_delete('public.internal_outlet_chats');

-- Work / pickup / order path
SELECT pg_temp.safe_delete('public.work_logs');
SELECT pg_temp.safe_delete('public.pickup_orders');

-- Pembayaran & omset
SELECT pg_temp.safe_delete('public.deposit_payment_credits');
SELECT pg_temp.safe_delete('public.deposit_topups');
SELECT pg_temp.safe_delete('public.membership_logs');
SELECT pg_temp.safe_delete('public.cash_deposits');
SELECT pg_temp.safe_delete('public.cashflow_logs');
SELECT pg_temp.safe_delete('public.expenses');
SELECT pg_temp.safe_delete('public.transactions');

-- Ops / inventory / absensi / mesin
SELECT pg_temp.safe_delete('public.submissions');
SELECT pg_temp.safe_delete('public.inventory_logs');
SELECT pg_temp.safe_delete('public.inventory');
SELECT pg_temp.safe_delete('public.system_tasks');
SELECT pg_temp.safe_delete('public.outlet_issues');
SELECT pg_temp.safe_delete('public.purchase_requests');
SELECT pg_temp.safe_delete('public.attendance_logs');
SELECT pg_temp.safe_delete('public.driver_attendance');
SELECT pg_temp.safe_delete('public.washer_cycle_logs');
SELECT pg_temp.safe_delete('public.unauthorized_wash_alerts');
SELECT pg_temp.safe_delete('public.daily_reconciliations');
SELECT pg_temp.safe_delete('public.financial_leakage_alerts');

-- Audit bayar / noise
SELECT pg_temp.safe_delete('public.payment_security_logs');
SELECT pg_temp.safe_delete('public.error_logs');
SELECT pg_temp.safe_delete('public.webhook_logs');
SELECT pg_temp.safe_delete('public.audit_logs');

-- CRM loyalty noise (profil pelanggan tetap; poin/saldo di-reset)
SELECT pg_temp.safe_delete('public.loyalty_point_logs');

DO $$
BEGIN
  UPDATE public.customers
  SET deposit_balance = 0
  WHERE coalesce(deposit_balance, 0) <> 0;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RAISE NOTICE 'skip customers.deposit_balance reset';
END $$;

DO $$
BEGIN
  UPDATE public.customer_crm_profiles
  SET loyalty_points = 0, total_spent = 0
  WHERE coalesce(loyalty_points, 0) <> 0 OR coalesce(total_spent, 0) <> 0;
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RAISE NOTICE 'skip customer_crm_profiles reset';
END $$;

-- -----------------------------------------------------------------------------
-- 3) Hapus outlet selain Sorcha Dago
--    (washers / outlet_machines / chats dengan ON DELETE CASCADE ikut bersih)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  keep_id uuid;
  deleted int;
BEGIN
  SELECT outlet_id INTO keep_id FROM _reset_keep LIMIT 1;

  DELETE FROM public.outlets
  WHERE id <> keep_id;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted other outlets: %', deleted;
END $$;

-- -----------------------------------------------------------------------------
-- 4) Bersihkan JSON app_settings (outlet non-keep); JANGAN kosongkan dynamic_services
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.as_json_obj(raw text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  j jsonb;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' OR btrim(raw) = 'null' THEN
    RETURN '{}'::jsonb;
  END IF;
  BEGIN
    j := raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN '{}'::jsonb;
  END;
  IF jsonb_typeof(j) = 'object' THEN
    RETURN j;
  END IF;
  IF jsonb_typeof(j) = 'string' THEN
    BEGIN
      RETURN coalesce((j #>> '{}')::jsonb, '{}'::jsonb);
    EXCEPTION WHEN others THEN
      RETURN '{}'::jsonb;
    END;
  END IF;
  RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.keep_outlet_map(j jsonb, keep text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  k text;
  v jsonb;
  outj jsonb := '{}'::jsonb;
  nested_out jsonb;
  k2 text;
  v2 jsonb;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(j)
  LOOP
    IF k = keep THEN
      outj := outj || jsonb_build_object(k, v);
    ELSIF k LIKE '\_\_%' ESCAPE '\' THEN
      IF jsonb_typeof(v) = 'object' THEN
        nested_out := '{}'::jsonb;
        FOR k2, v2 IN SELECT key, value FROM jsonb_each(v)
        LOOP
          IF k2 = keep THEN
            nested_out := nested_out || jsonb_build_object(k2, v2);
          END IF;
        END LOOP;
        outj := outj || jsonb_build_object(k, nested_out);
      ELSE
        outj := outj || jsonb_build_object(k, v);
      END IF;
    END IF;
  END LOOP;

  RETURN outj;
END;
$$;

DO $$
DECLARE
  keep_id text;
  ov jsonb;
  sm jsonb;
  books jsonb;
  profit jsonb;
  raw_ov text;
  raw_sm text;
  raw text;
BEGIN
  SELECT outlet_id::text INTO keep_id FROM _reset_keep LIMIT 1;

  SELECT outlet_overrides::text, supervisor_mapping::text
  INTO raw_ov, raw_sm
  FROM public.app_settings
  WHERE id = 1;

  ov := pg_temp.keep_outlet_map(pg_temp.as_json_obj(raw_ov), keep_id);
  sm := pg_temp.keep_outlet_map(pg_temp.as_json_obj(raw_sm), keep_id);

  UPDATE public.app_settings
  SET
    outlet_overrides = ov,
    supervisor_mapping = sm
  WHERE id = 1;

  BEGIN
    EXECUTE 'SELECT outlet_books::text FROM public.app_settings WHERE id = 1' INTO raw;
    books := pg_temp.keep_outlet_map(pg_temp.as_json_obj(raw), keep_id);
    EXECUTE 'UPDATE public.app_settings SET outlet_books = $1 WHERE id = 1' USING books;
  EXCEPTION WHEN undefined_column OR others THEN
    RAISE NOTICE 'skip app_settings.outlet_books (%)', SQLERRM;
  END;

  BEGIN
    EXECUTE 'SELECT profit_share_by_outlet::text FROM public.app_settings WHERE id = 1' INTO raw;
    profit := pg_temp.keep_outlet_map(pg_temp.as_json_obj(raw), keep_id);
    EXECUTE 'UPDATE public.app_settings SET profit_share_by_outlet = $1 WHERE id = 1' USING profit;
  EXCEPTION WHEN undefined_column OR others THEN
    RAISE NOTICE 'skip app_settings.profit_share_by_outlet (%)', SQLERRM;
  END;

  RAISE NOTICE 'app_settings JSON cleaned for keep=%; dynamic_services untouched', keep_id;
END $$;

-- -----------------------------------------------------------------------------
-- 5) Re-point karyawan ke outlet tersisa
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  keep_id uuid;
BEGIN
  SELECT outlet_id INTO keep_id FROM _reset_keep LIMIT 1;

  UPDATE public.employees
  SET
    outlet_id = keep_id,
    assigned_outlet_ids = ARRAY[keep_id::text]
  WHERE outlet_id IS DISTINCT FROM keep_id
     OR assigned_outlet_ids IS NULL
     OR assigned_outlet_ids <> ARRAY[keep_id::text];

  RAISE NOTICE 'employees re-pointed to %', keep_id;
EXCEPTION
  WHEN undefined_column THEN
    UPDATE public.employees SET outlet_id = (SELECT outlet_id FROM _reset_keep LIMIT 1);
    RAISE NOTICE 'employees.outlet_id updated (assigned_outlet_ids column missing)';
END $$;

COMMIT;

-- =============================================================================
-- VERIFIKASI CEPAT (jalankan setelah COMMIT — di luar transaksi di atas)
-- =============================================================================
-- A) Outlet
--    SELECT count(*) AS outlet_count FROM outlets;           -- expect 1
--    SELECT id, name FROM outlets;                          -- Sorcha Dago
--
-- B) Histori kosong (sample)
--    SELECT
--      (SELECT count(*) FROM transactions) AS txs,
--      (SELECT count(*) FROM work_logs) AS work_logs,
--      (SELECT count(*) FROM pickup_orders) AS pickups,
--      (SELECT count(*) FROM expenses) AS expenses,
--      (SELECT count(*) FROM membership_logs) AS memberships;
--
-- C) Katalog layanan global masih ada
--    SELECT jsonb_array_length(
--      CASE
--        WHEN jsonb_typeof(to_jsonb(dynamic_services)) = 'string'
--          THEN (dynamic_services #>> '{}')::jsonb
--        ELSE to_jsonb(dynamic_services)
--      END
--    ) AS service_count
--    FROM app_settings WHERE id = 1;
--    -- Atau sample nama:
--    SELECT jsonb_array_elements(
--      CASE
--        WHEN jsonb_typeof(to_jsonb(dynamic_services)) = 'string'
--          THEN (dynamic_services #>> '{}')::jsonb
--        ELSE to_jsonb(dynamic_services)
--      END
--    ) ->> 'name' AS service_name
--    FROM app_settings WHERE id = 1
--    LIMIT 10;
--
-- D) UI / CSV / POS
--    1. Owner → Settings → Dynamic Services (GLOBAL): Export CSV → edit di Sheets
--       → Import CSV → SIMPAN SEMUA PENGATURAN.
--    2. Buka POS outlet Sorcha Dago: daftar layanan muncul, buat order uji kecil.
--    3. Pastikan dropdown outlet hanya menampilkan Sorcha Dago.
-- =============================================================================
