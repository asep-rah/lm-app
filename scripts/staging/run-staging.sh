#!/usr/bin/env bash
# Run a staging step with secrets that live ONLY in this process.
#
#   scripts/staging/run-staging.sh check                      # read-only: guard + staging accepts keys + DB read-only probe
#   scripts/staging/run-staging.sh prepare --schema-dump <sanitised staging copy> [--dry-run | --rehearse]
#   scripts/staging/run-staging.sh e2e                        # builds against staging, then runs the E2E
#   scripts/staging/run-staging.sh cleanup [--execute] [--all]
#
# Non-secret: STAGING_REF / URL are fixed below; STAGING_DB_HOST (Session pooler host) from env or prompt.
# Secrets (anon key, service key, DB password) are read hidden — or from macOS Keychain items
# lm-staging-anon-key / lm-staging-service-key / lm-staging-db-password if present. Never printed,
# never written to disk or history, never placed in cloud environment settings.
set -euo pipefail

export STAGING_REF="mbkmhvcqklikaswlklrz"
export STAGING_SUPABASE_URL="https://$STAGING_REF.supabase.co"
PROD_REF="qlgbjvzabnfqmfnjdkmo"
die() { echo "✗ $*" >&2; exit 2; }

CMD="${1:-}"; [ -n "$CMD" ] && shift || die "usage: $0 check|prepare|e2e|cleanup [args]"
cd "$(dirname "$0")/../.."

secret() { # $1 var name, $2 keychain service, $3 prompt
  local v=""
  if command -v security >/dev/null 2>&1; then v="$(security find-generic-password -s "$2" -w 2>/dev/null || true)"; fi
  if [ -z "$v" ]; then printf '%s (tidak ditampilkan): ' "$3"; IFS= read -rs v; echo; fi
  [ -n "$v" ] || die "$1 is empty"
  case "$v" in *"$PROD_REF"*|sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs) die "$1 belongs to PRODUCTION";; esac
  export "$1=$v"
}

needs_db=0
case "$CMD" in check|prepare|cleanup) needs_db=1;; e2e) ;; *) die "unknown command $CMD";; esac

secret STAGING_SUPABASE_ANON_KEY lm-staging-anon-key "Anon key staging"
secret STAGING_SUPABASE_SERVICE_ROLE_KEY lm-staging-service-key "Service-role key staging"
if [ "$needs_db" = 1 ]; then
  if [ -z "${STAGING_DB_HOST:-}" ]; then printf 'Session pooler host staging (mis. aws-1-ap-southeast-1.pooler.supabase.com): '; IFS= read -r STAGING_DB_HOST; fi
  export STAGING_DB_HOST
  secret STAGING_DB_PASSWORD lm-staging-db-password "Password database STAGING"
  unset STAGING_DB_URL || true
fi
trap 'unset STAGING_SUPABASE_SERVICE_ROLE_KEY STAGING_DB_PASSWORD' EXIT

case "$CMD" in
  check) npx tsx scripts/staging/check-connection.ts ;;
  prepare) npx tsx scripts/staging/prepare.ts "$@" ;;
  cleanup) npx tsx scripts/staging/cleanup.ts "$@" ;;
  e2e)
    NEXT_PUBLIC_SUPABASE_URL="$STAGING_SUPABASE_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$STAGING_SUPABASE_ANON_KEY" npm run build
    npx tsx scripts/e2e/staging/run.ts "$@" ;;
esac
