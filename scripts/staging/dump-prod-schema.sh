#!/usr/bin/env bash
# READ-ONLY schema dump of the PRODUCTION public schema (no data) for staging.
#
#   scripts/staging/dump-prod-schema.sh <production-session-pooler-host> <output-file>
#   e.g. scripts/staging/dump-prod-schema.sh aws-1-ap-southeast-1.pooler.supabase.com ~/lm-staging/prod-schema.dump.sql
#
# Guarantees (each checked before pg_dump runs):
#  - user is postgres.qlgbjvzabnfqmfnjdkmo (production) derived here; host must be a Supabase pooler
#  - every statement runs with default_transaction_read_only=on; the session must report
#    transaction_read_only = on, otherwise the script stops
#  - pg_dump --schema-only --schema=public: catalog only, never table rows
#  - the password is read hidden, lives only in this process, never in history/args/files
#  - output goes OUTSIDE the repo, mode 600, never overwrites; a file containing data is deleted
# pg_dump takes ACCESS SHARE locks while reading the catalog: normal reads/writes continue.
set -euo pipefail

PROD_REF="qlgbjvzabnfqmfnjdkmo"
STAGING_REF="mbkmhvcqklikaswlklrz"
die() { echo "✗ $*" >&2; exit 2; }
ok() { echo "✓ $*"; }

[ $# -eq 2 ] || die "usage: $0 <production-session-pooler-host> <output-file>"
HOST="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
OUT="$2"

printf '%s' "$HOST" | grep -Eq '^[a-z0-9-]+\.pooler\.supabase\.com$' || die "host must be the Session pooler host (…pooler.supabase.com)"
case "$HOST" in *"$STAGING_REF"*) die "host mentions the staging ref";; esac
ok "host looks like a Supabase Session pooler: $HOST"

REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
OUT_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd -P)" || die "output directory does not exist: $(dirname "$OUT")"
OUT_ABS="$OUT_DIR/$(basename "$OUT")"
case "$OUT_ABS" in "$REPO"/*) die "output must be outside the repository ($REPO)";; esac
[ ! -e "$OUT_ABS" ] || die "output already exists (refusing to overwrite): $OUT_ABS"
case "$OUT_ABS" in *.dump.sql) ;; *) die "output name must end with .dump.sql";; esac
ok "output: $OUT_ABS"

command -v psql >/dev/null || die "psql not found (brew install libpq; add \$(brew --prefix libpq)/bin to PATH)"
command -v pg_dump >/dev/null || die "pg_dump not found (brew install libpq)"

printf 'Password database PRODUKSI (tidak ditampilkan): '
IFS= read -rs PGPASSWORD; echo
[ -n "$PGPASSWORD" ] || die "empty password"
export PGPASSWORD
trap 'unset PGPASSWORD' EXIT

export PGHOST="$HOST" PGPORT=5432 PGUSER="postgres.$PROD_REF" PGDATABASE=postgres PGSSLMODE=require
export PGCONNECT_TIMEOUT=15 PGAPPNAME=lm-schema-dump-readonly
export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000"

RO="$(psql -X -At -c 'show transaction_read_only')" || die "cannot connect (check host/password)"
[ "$RO" = "on" ] || die "session is not read-only (transaction_read_only=$RO) — stopping"
ok "connected as postgres.$PROD_REF; session is read-only (transaction_read_only=on)"

SERVER_MAJOR="$(psql -X -At -c 'show server_version_num' | awk '{print int($1/10000)}')"
DUMP_MAJOR="$(pg_dump --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')"
[ "$DUMP_MAJOR" -ge "$SERVER_MAJOR" ] || die "pg_dump $DUMP_MAJOR is older than server $SERVER_MAJOR (brew upgrade libpq)"
ok "pg_dump $DUMP_MAJOR ≥ server $SERVER_MAJOR"

echo "About to READ the schema (no rows) of PRODUCTION project $PROD_REF."
printf 'Ketik ref produksi untuk lanjut: '
IFS= read -r CONFIRM
[ "$CONFIRM" = "$PROD_REF" ] || die "confirmation did not match — nothing was dumped"

umask 077
pg_dump --schema-only --schema=public --no-owner --file="$OUT_ABS"
chmod 600 "$OUT_ABS"
ok "schema-only dump written ($(wc -l < "$OUT_ABS" | tr -d ' ') lines)"

set +e
(cd "$REPO" && npx tsx scripts/staging/check-dump.ts "$OUT_ABS")
CHECK=$?
set -e
if [ "$CHECK" -eq 2 ]; then
  rm -P "$OUT_ABS" 2>/dev/null || rm -f "$OUT_ABS"
  die "dump contained data statements — file deleted"
fi
[ "$CHECK" -eq 0 ] && ok "dump is clean" || echo "• dump needs review before use (see list above)"
