/**
 * Validates a production SCHEMA-ONLY dump before it is used for staging.
 * Statement-aware (scripts/staging/sqlLexer.ts): DML inside a function body is
 * part of a definition, DML at top level is data. Findings never echo content
 * that could hold secrets or data: only line numbers plus a keyword, object
 * name or URL host.
 *
 * Blocking (never apply; dump-prod-schema.sh deletes such a file):
 * - dataStatements: top-level INSERT/UPDATE/DELETE/MERGE/TRUNCATE/COPY, COPY
 *   data blocks, setval, and any top-level statement or psql meta-command
 *   outside the allowlist of what a schema-only pg_dump emits.
 * Must be neutralised (sanitize-dump.ts does it; prepare.ts refuses otherwise):
 * - outboundHttp: Database Webhook triggers, pg_net/http calls, external URLs.
 * - productionRefs: the production project ref.
 * - secretLike: JWTs, sb_secret_/sk_live_/sk_test_ keys, Bearer tokens,
 *   key/token/secret/password assignments with a long value.
 * - foreignDefaultPrivileges: ALTER DEFAULT PRIVILEGES FOR ROLE <not postgres>
 *   (e.g. supabase_admin); the staging apply role cannot run them
 *   (scripts/staging/privileges.ts).
 * Informational:
 * - functionBodyDml: DML inside CREATE FUNCTION/PROCEDURE (definition, not data).
 * - notes: extensions, extra schemas, event triggers, grants to non-standard roles.
 */
import { foreignDefaultPrivileges } from './privileges';
import { leadingWords, splitSqlStatements, type SqlStatement } from './sqlLexer';

export type DumpReport = {
  dataStatements: string[];
  outboundHttp: string[];
  productionRefs: string[];
  secretLike: string[];
  foreignDefaultPrivileges: string[];
  functionBodyDml: string[];
  notes: string[];
};

export const NEUTRAL_HOST = 'staging-disabled.invalid';

const STANDARD_ROLES = new Set([
  'anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin', 'public',
  'dashboard_user', 'supabase_auth_admin', 'supabase_storage_admin', 'authenticator',
  'pgbouncer', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_read_only_user'
]);

/** Top-level statements a schema-only pg_dump emits. Everything else blocks. */
const ALLOWED_TOP_LEVEL = /^(SET|CREATE|ALTER|COMMENT|GRANT|REVOKE|SECURITY LABEL)\b/i;
const ALLOWED_SELECT = /^SELECT\s+pg_catalog\.set_config\s*\(/i;
const ALLOWED_META = /^\\(restrict|unrestrict)\s+[A-Za-z0-9]+\s*$/;
const DATA_VERBS = /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY|WITH|DO|CALL)\b/i;

export const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g],
  ['sb_secret', /sb_secret_[A-Za-z0-9_-]{8,}/g],
  ['stripe-like key', /\bsk_(live|test)_[A-Za-z0-9]{8,}/g],
  ['bearer token', /Bearer\s+(?!REDACTED\b)[A-Za-z0-9._~+/=-]{8,}/g],
  ['key/token assignment', /\b(api[_-]?key|apikey|secret|token|password|passwd)\b(["']?\s*(?::=|=>|=|:)\s*)(["'])(?!REDACTED\b)[^"'\s]{12,}\3/gi]
];

const lineAt = (stmt: SqlStatement, offset: number) => stmt.line + (stmt.text.slice(0, offset).match(/\n/g) || []).length;

const WEBHOOK_TRIGGER = /^CREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER\s+("?[\w$]+"?)[\s\S]*?\bON\s+([\w."$]+)[\s\S]*supabase_functions\.http_request\s*\(/i;

export const webhookTriggerOf = (stmt: SqlStatement): { name: string; table: string } | null => {
  if (stmt.kind !== 'sql') return null;
  const m = WEBHOOK_TRIGGER.exec(stmt.text);
  return m ? { name: m[3].replace(/"/g, ''), table: m[4] } : null;
};

export const inspectStatements = (stmts: SqlStatement[], productionRef: string): DumpReport => {
  const r: DumpReport = { dataStatements: [], outboundHttp: [], productionRefs: [], secretLike: [], foreignDefaultPrivileges: [], functionBodyDml: [], notes: [] };
  const prodRe = new RegExp(productionRef, 'gi');
  for (const s of stmts) {
    const n = `line ${s.line}`;
    if (s.kind === 'copydata') {
      r.dataStatements.push(`${n}: COPY data block`);
      continue;
    }
    if (s.kind === 'meta') {
      if (!ALLOWED_META.test(s.text)) r.dataStatements.push(`${n}: psql meta-command ${s.text.split(/\s+/)[0]}`);
      continue;
    }
    const words = leadingWords(s.text);
    if (DATA_VERBS.test(s.text)) {
      const target = /^(INSERT\s+INTO|COPY|UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?|MERGE\s+INTO)\s+([\w."$]+)/i.exec(s.text);
      r.dataStatements.push(`${n}: ${target ? `${target[1].toUpperCase()} ${target[3]}` : words.split(' ')[0]}`);
    } else if (/^SELECT\b/i.test(s.text) && !ALLOWED_SELECT.test(s.text)) {
      r.dataStatements.push(`${n}: ${/^SELECT\s+pg_catalog\.setval/i.test(s.text) ? 'SELECT setval (sequence state)' : 'top-level SELECT'}`);
    } else if (!ALLOWED_TOP_LEVEL.test(s.text) && !ALLOWED_SELECT.test(s.text)) {
      r.dataStatements.push(`${n}: unexpected top-level statement ${words.split(' ')[0]}`);
    }

    if (/^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b/i.test(s.text)) {
      const fn = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w."$]+)/i.exec(s.text)?.[1] || '?';
      const dml = new Set<string>();
      for (const m of s.text.matchAll(/\b(insert\s+into|update|delete\s+from)\s+([\w."$]+)/gi)) {
        if (/^update$/i.test(m[1]) && /^(set|of)$/i.test(m[2])) continue;
        dml.add(`${m[1].toUpperCase().replace(/\s+/g, ' ')} ${m[2]}`);
      }
      if (dml.size) r.functionBodyDml.push(`${n}: ${fn} → ${[...dml].join(', ')}`);
    }

    const foreign = foreignDefaultPrivileges(s);
    if (foreign.length) r.foreignDefaultPrivileges.push(`${n}: ALTER DEFAULT PRIVILEGES FOR ROLE ${foreign.join(', ')}`);

    const hook = webhookTriggerOf(s);
    if (hook) r.outboundHttp.push(`${n}: Database Webhook trigger ${hook.name} ON ${hook.table}`);
    // An HTTP call is neutral only when every literal URL in the statement
    // points at the neutral host; a call without a literal URL has a dynamic
    // target (setting/table) and cannot be neutralised statically.
    const urls = [...s.text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    const allNeutral = urls.length > 0 && urls.every((h) => h === NEUTRAL_HOST);
    for (const m of s.text.matchAll(/net\.http_(get|post|delete)|extensions\.http\b|\bhttp_(get|post)\s*\(/gi)) {
      if (!allNeutral) r.outboundHttp.push(`line ${lineAt(s, m.index ?? 0)}: ${m[0]}${urls.length ? '' : ' (dynamic target)'}`);
    }
    for (const m of s.text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (host !== NEUTRAL_HOST) r.outboundHttp.push(`line ${lineAt(s, m.index ?? 0)}: URL host ${host}`);
    }
    for (const m of s.text.matchAll(prodRe)) r.productionRefs.push(`line ${lineAt(s, m.index ?? 0)}: production ref`);
    for (const [label, re] of SECRET_PATTERNS) {
      for (const m of s.text.matchAll(re)) r.secretLike.push(`line ${lineAt(s, m.index ?? 0)}: ${label}`);
    }

    const ext = /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w]+)"?/i.exec(s.text);
    if (ext) r.notes.push(`${n}: extension ${ext[1]}`);
    const schema = /^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w]+)"?/i.exec(s.text);
    if (schema && schema[1].toLowerCase() !== 'public') r.notes.push(`${n}: schema ${schema[1]}`);
    if (/^CREATE\s+EVENT\s+TRIGGER/i.test(s.text)) r.notes.push(`${n}: event trigger`);
    const grant = /^GRANT\s[\s\S]*\sTO\s+([^;]+);?$/i.exec(s.text);
    if (grant) {
      grant[1]
        .split(',')
        .map((x) => x.trim().replace(/"/g, '').replace(/\s+WITH\s+GRANT\s+OPTION$/i, '').toLowerCase())
        .filter((role) => role && !STANDARD_ROLES.has(role))
        .forEach((role) => r.notes.push(`${n}: grant to non-standard role ${role}`));
    }
  }
  return r;
};

export const inspectSchemaDump = (sql: string, productionRef: string): DumpReport =>
  inspectStatements(splitSqlStatements(sql), productionRef);

/** Items that must be neutralised (or removed) before the file may reach staging. */
export const needsReview = (r: DumpReport) =>
  r.outboundHttp.length + r.productionRefs.length + r.secretLike.length + r.foreignDefaultPrivileges.length > 0;
