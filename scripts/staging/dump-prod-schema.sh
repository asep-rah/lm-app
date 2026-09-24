#!/usr/bin/env bash
# READ-ONLY schema dump of the PRODUCTION public schema (no data) for staging.
#
#   scripts/staging/dump-prod-schema.sh <host> <output-file>
#     host = db.qlgbjvzabnfqmfnjdkmo.supabase.co        (direct, IPv6)   or
#            <region>.pooler.supabase.com                (Session pooler, IPv4)
#
# Read-only enforcement (checked before pg_dump runs; the script stops otherwise):
#  - direct: PGOPTIONS default_transaction_read_only=on reaches Postgres; the
#    session must report transaction_read_only = on (every statement read-only).
#  - Session pooler: Supavisor drops libpq startup options, so PGOPTIONS cannot
#    reach Postgres. Instead:
#      * every psql probe runs inside BEGIN TRANSACTION READ ONLY and must
#        report transaction_read_only = on;
#      * pg_dump runs only if THIS pg_dump binary (path + version) was proven by
#        scripts/staging/prove-pgdump-readonly.sh on a local Supabase stack:
#        through Supavisor it issues only session-local SETs, then
#        SET TRANSACTION … READ ONLY, then SELECT / LOCK ACCESS SHARE /
#        PREPARE…AS SELECT / EXECUTE (proof stamp ~/lm-staging/.pgdump-readonly-proof).
#  - no role, setting or object is changed in production.
#  - pg_dump --schema-only --schema=public: catalog only, never table rows
#  - the password is read hidden, lives only in this process, never in history/args/files
#  - output goes OUTSIDE the repo, mode 600, never overwrites; a file containing data is deleted
# pg_dump takes ACCESS SHARE locks while reading the catalog: normal reads/writes continue.
set -euo pipefail

PROD_REF="qlgbjvzabnfqmfnjdkmo"
STAGING_REF="mbkmhvcqklikaswlklrz"
die() { echo "✗ $*" >&2; exit 2; }
ok() { echo "✓ $*"; }

[ $# -eq 2 ] || die "usage: $0 <db.<prod-ref>.supabase.co | session-pooler-host> <output-file>"
HOST="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
OUT="$2"

case "$HOST" in *"$STAGING_REF"*) die "host mentions the staging ref";; esac
if [ "$HOST" = "db.$PROD_REF.supabase.co" ]; then
  MODE=direct; DB_USER=postgres
elif printf '%s' "$HOST" | grep -Eq '^[a-z0-9-]+\.pooler\.supabase\.com$'; then
  MODE=pooler; DB_USER="postgres.$PROD_REF"
else
  die "host must be db.$PROD_REF.supabase.co (direct) or the Session pooler host (…pooler.supabase.com)"
fi
ok "mode: $MODE ($HOST, user $DB_USER)"

REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
OUT_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd -P)" || die "output directory does not exist: $(dirname "$OUT")"
OUT_ABS="$OUT_DIR/$(basename "$OUT")"
case "$OUT_ABS" in "$REPO"/*) die "output must be outside the repository ($REPO)";; esac
[ ! -e "$OUT_ABS" ] || die "output already exists (refusing to overwrite): $OUT_ABS"
case "$OUT_ABS" in *.dump.sql) ;; *) die "output name must end with .dump.sql";; esac
ok "output: $OUT_ABS"

command -v psql >/dev/null || die "psql not found (brew install libpq; add \$(brew --prefix libpq)/bin to PATH)"
command -v pg_dump >/dev/null || die "pg_dump not found (brew install libpq)"
if [ "$MODE" = pooler ]; then
  STAMP="$HOME/lm-staging/.pgdump-readonly-proof"
  [ -f "$STAMP" ] || die "pooler mode needs the read-only proof first: scripts/staging/prove-pgdump-readonly.sh (PANDUAN_MAC.md §3a)"
  grep -qxF "pg_dump_path=$(command -v pg_dump)" "$STAMP" || die "proof was made with a different pg_dump binary — re-run prove-pgdump-readonly.sh"
  grep -qxF "pg_dump_version=$(pg_dump --version)" "$STAMP" || die "proof was made with a different pg_dump version — re-run prove-pgdump-readonly.sh"
  ok "read-only proof matches this pg_dump ($(pg_dump --version))"
fi

printf 'Password database PRODUKSI (tidak ditampilkan): '
IFS= read -rs PGPASSWORD; echo
[ -n "$PGPASSWORD" ] || die "empty password"
export PGPASSWORD
trap 'unset PGPASSWORD' EXIT

export PGHOST="$HOST" PGPORT=5432 PGUSER="$DB_USER" PGDATABASE=postgres PGSSLMODE=require
export PGCONNECT_TIMEOUT=15 PGAPPNAME=lm-schema-dump-readonly
export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000"

# Every probe runs inside an explicit read-only transaction (works through the pooler too).
PROBE="$(psql -X -At -v ON_ERROR_STOP=1 \
  -c 'begin transaction read only' \
  -c 'show transaction_read_only' \
  -c 'show server_version_num' \
  -c 'select current_user' \
  -c 'rollback')" || die "cannot connect (check host/password)"
TX_RO="$(printf '%s\n' "$PROBE" | sed -n 2p)"
SERVER_NUM="$(printf '%s\n' "$PROBE" | sed -n 3p)"
[ "$TX_RO" = "on" ] || die "probe transaction is not read-only (transaction_read_only=$TX_RO) — stopping"
ok "connected as $DB_USER; probes ran in a READ ONLY transaction (transaction_read_only=on)"

SESSION_RO="$(psql -X -At -c 'show transaction_read_only')" || die "cannot connect"
if [ "$MODE" = direct ]; then
  [ "$SESSION_RO" = "on" ] || die "session is not read-only (transaction_read_only=$SESSION_RO) — stopping"
  ok "direct: PGOPTIONS reached Postgres; the whole session is read-only"
else
  echo "• pooler: session default transaction_read_only=$SESSION_RO (startup options are dropped by Supavisor); relying on the proven pg_dump READ ONLY transaction"
fi

SERVER_MAJOR="$(awk -v n="$SERVER_NUM" 'BEGIN{print int(n/10000)}')"
DUMP_MAJOR="$(pg_dump --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')"
[ "$DUMP_MAJOR" -ge "$SERVER_MAJOR" ] || die "pg_dump $DUMP_MAJOR is older than server $SERVER_MAJOR (brew upgrade libpq)"
ok "pg_dump $DUMP_MAJOR ≥ server $SERVER_MAJOR"

echo "About to READ the schema (no rows) of PRODUCTION project $PROD_REF."
printf 'Ketik ref produksi untuk lanjut: '
IFS= read -r CONFIRM
[ "$CONFIRM" = "$PROD_REF" ] || die "confirmation did not match — nothing was dumped"

umask 077
pg_dump --schema-only --schema=public --no-owner --lock-wait-timeout=5000 --file="$OUT_ABS"
chmod 600 "$OUT_ABS"
ok "schema-only dump written ($(wc -l < "$OUT_ABS" | tr -d ' ') lines)"

set +e
(cd "$REPO" && npx tsx scripts/staging/check-dump.ts "$OUT_ABS")
CHECK=$?
set -e
if [ "$CHECK" -eq 2 ]; then
  rm -P "$OUT_ABS" 2>/dev/null || rm -f "$OUT_ABS"
  die "dump contained top-level data / non-schema statements — file deleted"
fi
echo "Next: create the staging copy (the production dump itself is never applied):"
echo "  npx tsx scripts/staging/sanitize-dump.ts $OUT_ABS $(dirname "$OUT_ABS")/staging-schema.dump.sql"
