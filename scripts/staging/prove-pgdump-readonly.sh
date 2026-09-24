#!/usr/bin/env bash
# PROOF on a LOCAL Supabase stack that this machine's pg_dump, going through
# Supavisor (Session pooler), only issues read-only statements.
#
# Why: Supavisor does not forward the libpq startup "options" (PGOPTIONS), so
# default_transaction_read_only cannot be imposed from outside on a pooled
# pg_dump session. pg_dump itself runs its work inside
# "SET TRANSACTION … READ ONLY"; this script proves that — statement by
# statement — for the exact pg_dump binary that will later read production,
# and writes a stamp that dump-prod-schema.sh requires in pooler mode.
#
# Requirements: Docker + Supabase CLI local stack started with the pooler
# enabled in session mode (see PANDUAN_MAC.md §3a). LOCAL ONLY: refuses any
# host other than 127.0.0.1 and only changes settings of the local container.
#
#   scripts/staging/prove-pgdump-readonly.sh            # uses 127.0.0.1:54329 (pooler) / 54322 (direct)
set -euo pipefail

POOLER_PORT="${POOLER_PORT:-54329}"
DIRECT_PORT="${DIRECT_PORT:-54322}"
LOCAL_TENANT_USER="${LOCAL_TENANT_USER:-postgres.pooler-dev}"
STAMP_DIR="${STAMP_DIR:-$HOME/lm-staging}"
die() { echo "✗ $*" >&2; exit 2; }
ok() { echo "✓ $*"; }

command -v docker >/dev/null || die "docker not found"
command -v pg_dump >/dev/null || die "pg_dump not found"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)"
[ -n "$DB_CONTAINER" ] || die "no local Supabase stack running (supabase_db_* container)"
docker ps --format '{{.Names}}' | grep -Eq '^supabase_pooler_' || die "local pooler (Supavisor) not running — enable [db.pooler] in supabase/config.toml"
ok "local stack: $DB_CONTAINER"

export PGHOST=127.0.0.1 PGDATABASE=postgres PGPASSWORD=postgres PGSSLMODE=disable
unset PGOPTIONS
LOCALQ() { psql -X -At -p "$DIRECT_PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
POOLQ() { psql -X -At -p "$POOLER_PORT" -U "$LOCAL_TENANT_USER" -v ON_ERROR_STOP=1 "$@"; }
ADMIN() { docker exec "$DB_CONTAINER" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

# Local fixture: one table with a row, RLS policy, trigger, sequence.
LOCALQ -q -c "drop schema if exists lm_ro_probe cascade" -c "drop table if exists public.lm_ro_probe cascade" >/dev/null
LOCALQ -q -c "create table public.lm_ro_probe (id int primary key, secret text not null)" \
  -c "insert into public.lm_ro_probe values (1, 'ROW-DATA-MUST-NOT-APPEAR')" \
  -c "alter table public.lm_ro_probe enable row level security" \
  -c "create policy lm_ro_probe_read on public.lm_ro_probe for select using (true)" >/dev/null
ok "local fixture created"

PGOPTIONS="-c default_transaction_read_only=on" POOLQ -c "show transaction_read_only" > /tmp/lm_ro_opt.$$ 2>&1 || true
OPT="$(tail -1 /tmp/lm_ro_opt.$$)"; rm -f /tmp/lm_ro_opt.$$
echo "• pooler + PGOPTIONS → transaction_read_only=$OPT (off = startup options are dropped by Supavisor)"
RO_IN_TX="$(POOLQ -c "begin transaction read only" -c "show transaction_read_only" -c "rollback" | sed -n 2p)"
[ "$RO_IN_TX" = "on" ] || die "BEGIN TRANSACTION READ ONLY through the pooler did not give transaction_read_only=on"
ok "BEGIN TRANSACTION READ ONLY through the pooler → transaction_read_only=on"

ADMIN -c "alter database postgres set log_statement = 'all'"
trap 'ADMIN -c "alter database postgres reset log_statement" >/dev/null 2>&1 || true' EXIT
TAG="lmro$$$(date +%s)"
POOLQ -c "select 'MARK-begin-$TAG'" >/dev/null
OUT="$(mktemp -t lm-ro-dump.XXXXXX)"
PGOPTIONS="-c default_transaction_read_only=on" pg_dump -p "$POOLER_PORT" -U "$LOCAL_TENANT_USER" \
  --schema-only --schema=public --no-owner --lock-wait-timeout=5000 --file="$OUT"
POOLQ -c "select 'MARK-end-$TAG'" >/dev/null
sleep 1
STMTS="$(mktemp -t lm-ro-stmts.XXXXXX)"
# One statement per line: multi-line statements (continuation lines start
# with whitespace in the server log) are joined before any check.
docker logs "$DB_CONTAINER" 2>&1 \
  | awk -v b="MARK-begin-$TAG" -v e="MARK-end-$TAG" 'index($0,b){f=1;next} index($0,e){f=0} f' \
  | awk '
      /LOG:  (statement|execute [^:]*): / { if (cur != "") print cur; sub(/^.*LOG:  (statement|execute [^:]*): /, ""); cur = $0; next }
      /^[ \t]/ { if (cur != "") { cur = cur " " $0 }; next }
      { if (cur != "") print cur; cur = "" }
      END { if (cur != "") print cur }' \
  | tr -s ' \t' ' ' > "$STMTS"
N="$(wc -l < "$STMTS" | tr -d ' ')"
[ "$N" -gt 5 ] || die "could not capture pg_dump statements from the local log ($N)"
ok "captured $N statements issued by pg_dump through the pooler"

# 1. A read-only transaction must be opened.
RO_LINE="$(grep -n -E '^SET TRANSACTION ISOLATION LEVEL [A-Z ]+, READ ONLY' "$STMTS" | head -1 | cut -d: -f1 || true)"
[ -n "$RO_LINE" ] || die "pg_dump did not open a READ ONLY transaction"
ok "pg_dump opens a READ ONLY transaction (statement $RO_LINE)"

# 2. Before it: only session-local settings (nothing persistent, nothing written).
PRE_BAD="$(head -n $((RO_LINE - 1)) "$STMTS" | grep -v -E \
  '^(DISCARD ALL|BEGIN|SET [A-Za-z_]+ (=|TO) .*|SELECT pg_catalog\.set_config\(.*, false\);?|SELECT pg_catalog\.pg_is_in_recovery\(\)|SELECT set_config\(name, .*, false\) FROM pg_settings WHERE name = .*)$' || true)"
[ -z "$PRE_BAD" ] || { echo "$PRE_BAD" | cut -c1-160; die "unexpected statement before the read-only transaction"; }
ok "before it: only session-local settings (DISCARD/SET/set_config(…, false))"

# 3. Whole run: statement kinds on an allowlist; no write/DDL verb anywhere.
BAD_KIND="$(awk '{print toupper($1)}' "$STMTS" | grep -v -E '^(SELECT|SET|PREPARE|EXECUTE|LOCK|BEGIN|COMMIT|ROLLBACK|DISCARD|DEALLOCATE|SHOW)$' | sort -u || true)"
[ -z "$BAD_KIND" ] || die "non-allowlisted statement kinds: $BAD_KIND"
grep -E '^PREPARE ' "$STMTS" | grep -v -E ' AS ?SELECT ' >/dev/null && die "a PREPARE is not a SELECT" || true
grep -E '^LOCK ' "$STMTS" | grep -v -E ' IN ACCESS SHARE MODE' >/dev/null && die "a LOCK is stronger than ACCESS SHARE" || true
ok "all statements: SELECT/SET/LOCK(ACCESS SHARE)/PREPARE…AS SELECT/EXECUTE/BEGIN/DISCARD"

# 4. Output is schema only; local data untouched.
grep -q 'ROW-DATA-MUST-NOT-APPEAR' "$OUT" && die "row data appeared in the dump"
grep -Eq '^(COPY|INSERT) ' "$OUT" && die "data statements in the dump"
[ "$(LOCALQ -c 'select count(*) from public.lm_ro_probe')" = "1" ] || die "local fixture changed"
ok "dump contains schema only; fixture row untouched"

LOCALQ -q -c "drop table public.lm_ro_probe" >/dev/null
rm -f "$OUT"

VERSION="$(pg_dump --version)"
mkdir -p "$STAMP_DIR" && chmod 700 "$STAMP_DIR"
STAMP="$STAMP_DIR/.pgdump-readonly-proof"
{
  echo "pg_dump_path=$(command -v pg_dump)"
  echo "pg_dump_version=$VERSION"
  echo "proved_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "statements=$N readonly_tx_at=$RO_LINE"
  echo "kinds=$(awk '{print toupper($1)}' "$STMTS" | sort | uniq -c | awk '{printf "%s:%s ", $2, $1}')"
} > "$STAMP"
chmod 600 "$STAMP"
rm -f "$STMTS"
ok "proof stamp written: $STAMP ($VERSION)"
