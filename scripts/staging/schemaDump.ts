/**
 * Validates a production SCHEMA-ONLY dump before it is applied to staging.
 * Findings never echo line contents that could hold secrets or data: only a
 * line number plus a keyword, table name or URL host.
 *
 * Blocking (prepare.ts refuses):
 * - dataStatements: COPY … FROM stdin / INSERT INTO — no customer data may
 *   travel to staging through this file.
 * Must be reviewed (prepare.ts needs --outbound-http-reviewed):
 * - outboundHttp: pg_net / http extension / database webhooks / URLs — a
 *   cloned trigger could call production endpoints from staging.
 * - productionRefs: the production project ref inside the schema.
 * - secretLike: string literals that look like keys/tokens/passwords.
 * Informational:
 * - notes: extensions, extra schemas, event triggers, grants to non-standard roles.
 */
export type DumpReport = {
  dataStatements: string[];
  outboundHttp: string[];
  productionRefs: string[];
  secretLike: string[];
  notes: string[];
};

const STANDARD_ROLES = new Set([
  'anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin', 'public',
  'dashboard_user', 'supabase_auth_admin', 'supabase_storage_admin', 'authenticator',
  'pgbouncer', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_read_only_user'
]);

export const inspectSchemaDump = (sql: string, productionRef: string): DumpReport => {
  const r: DumpReport = { dataStatements: [], outboundHttp: [], productionRefs: [], secretLike: [], notes: [] };
  const prodRe = new RegExp(productionRef, 'i');
  sql.split(/\r?\n/).forEach((line, i) => {
    const n = `line ${i + 1}`;
    const copy = line.match(/^\s*COPY\s+([^\s(]+).*FROM\s+stdin/i);
    if (copy) r.dataStatements.push(`${n}: COPY ${copy[1]}`);
    const ins = line.match(/^\s*INSERT\s+INTO\s+([^\s(]+)/i);
    if (ins) r.dataStatements.push(`${n}: INSERT INTO ${ins[1]}`);

    const http = line.match(/net\.http_(get|post|delete)|extensions\.http\b|\bhttp_(get|post)\s*\(|supabase_functions\.http_request/i);
    if (http) r.outboundHttp.push(`${n}: ${http[0]}`);
    for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) r.outboundHttp.push(`${n}: URL host ${m[1].toLowerCase()}`);

    if (prodRe.test(line)) r.productionRefs.push(`${n}: production ref`);

    const secret = line.match(/'[^']*(sk_live|sk_test|sb_secret_|service_role|eyJhbGciOi|bearer\s)[^']*'|(api[_-]?key|secret|token|password)\s*(:=|=|=>)\s*'[^']+'/i);
    if (secret) r.secretLike.push(`${n}: ${(secret[1] || secret[2] || 'secret').toLowerCase()}`);

    const ext = line.match(/^\s*CREATE EXTENSION[^;]*?\b(?:IF NOT EXISTS\s+)?"?([a-z0-9_]+)"?/i);
    if (ext) r.notes.push(`${n}: extension ${ext[1]}`);
    const schema = line.match(/^\s*CREATE SCHEMA\s+(?:IF NOT EXISTS\s+)?"?([a-z0-9_]+)"?/i);
    if (schema && schema[1].toLowerCase() !== 'public') r.notes.push(`${n}: schema ${schema[1]}`);
    if (/^\s*CREATE EVENT TRIGGER/i.test(line)) r.notes.push(`${n}: event trigger`);
    const grant = line.match(/^\s*GRANT .* TO ([^;]+);/i);
    if (grant) {
      grant[1]
        .split(',')
        .map((x) => x.trim().replace(/"/g, '').toLowerCase())
        .filter((role) => role && !STANDARD_ROLES.has(role))
        .forEach((role) => r.notes.push(`${n}: grant to non-standard role ${role}`));
    }
  });
  return r;
};

/** Findings that must be looked at by a human before applying. */
export const needsReview = (r: DumpReport) => r.outboundHttp.length + r.productionRefs.length + r.secretLike.length > 0;
