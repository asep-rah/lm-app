/**
 * Migrations applied to staging on top of the production schema dump: those of
 * PR #5 (already in production, idempotent) plus later ones not yet released.
 */
export const PR_MIGRATION_FILES = [
  '20260923_customer_verified_login.sql',
  '20260924_satuan_item_photos.sql',
  '20260925_service_role_log_grants.sql',
  '20260926_customer_order_server_grants.sql',
  '20260927_service_role_server_grants.sql',
  '20260928_revoke_anon_pickup_insert.sql',
  '20260929_service_role_sequence_usage.sql',
  '20260930_order_driver_chat.sql',
  '20261001_customer_phone_keys_international.sql'
];
