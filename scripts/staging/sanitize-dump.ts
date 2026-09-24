/**
 * Build the STAGING copy of a production schema-only dump (offline file → file).
 *
 *   npx tsx scripts/staging/sanitize-dump.ts ~/lm-staging/prod-schema.dump.sql ~/lm-staging/staging-schema.dump.sql
 *
 * - Refuses (writes nothing) if the input contains any top-level data or
 *   non-allowlisted statement.
 * - Removes Database Webhook triggers (supabase_functions.http_request) and
 *   their ENABLE/DISABLE/COMMENT statements.
 * - Rewrites every http(s) URL host to staging-disabled.invalid (pg_net /
 *   http calls from functions cannot reach any real endpoint), redacts
 *   JWTs, sb_secret_/sk_ keys, Bearer tokens and key/token/password values,
 *   and replaces the production project ref.
 * - Re-inspects the result and deletes it unless it is clean.
 * Output: mode 600, never overwrites, outside the repo, first line
 * "-- lm-staging-sanitized v1" (required by prepare.ts). Prints counts,
 * object names and hosts only — never statement contents.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PRODUCTION_SUPABASE_REF } from '../../lib/supabaseTarget';
import { inspectStatements, needsReview, NEUTRAL_HOST, SECRET_PATTERNS, webhookTriggerOf } from './schemaDump';
import { describeNotNull, findNotNull } from './columnNotNull';
import { splitSqlStatements } from './sqlLexer';

export const SANITIZED_HEADER = '-- lm-staging-sanitized v1';

export type SanitizeChange = { line: number; object: string; change: string };

export type SanitizeResult = {
  sql: string;
  /** Per-statement changes: line in the input, object label, what changed (no contents). */
  changes: SanitizeChange[];
  removedTriggers: string[];
  hosts: Record<string, number>;
  redacted: number;
  prodRefs: number;
};

export function sanitizeSchemaDump(input: string, productionRef = PRODUCTION_SUPABASE_REF): SanitizeResult {
  const stmts = splitSqlStatements(input);
  const report = inspectStatements(stmts, productionRef);
  if (report.dataStatements.length) {
    throw new Error(`input contains data or non-schema statements (${report.dataStatements.length}); first: ${report.dataStatements[0]}`);
  }
  const removed = new Map<string, string>(); // trigger name → table
  for (const s of stmts) {
    const hook = webhookTriggerOf(s);
    if (hook) removed.set(hook.name.toLowerCase(), hook.table);
  }
  const hosts: Record<string, number> = {};
  let redacted = 0;
  let prodRefs = 0;
  const prodRe = new RegExp(productionRef, 'gi');
  const refersToRemovedTrigger = (text: string) => {
    const m =
      /^ALTER\s+TABLE\s+(?:ONLY\s+)?[\w."$]+\s+(?:ENABLE|DISABLE)\s+(?:ALWAYS\s+|REPLICA\s+)?TRIGGER\s+"?([\w$]+)"?/i.exec(text) ||
      /^COMMENT\s+ON\s+TRIGGER\s+"?([\w$]+)"?/i.exec(text);
    return m ? removed.has(m[1].toLowerCase()) : false;
  };

  const parts: string[] = [];
  const changes: SanitizeChange[] = [];
  const objectOf = (text: string) =>
    (text.match(/^(?:CREATE|ALTER|COMMENT\s+ON)\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?([A-Z ]+?)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:ONLY\s+)?("?[\w$.]+"?(?:\.[\w$"]+)?)/i) || [])
      .slice(1, 3)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || text.split(/\s+/).slice(0, 3).join(' ');
  for (const s of stmts) {
    if (s.kind === 'meta') {
      parts.push(s.text);
      continue;
    }
    const hook = webhookTriggerOf(s);
    if (hook) {
      parts.push(`-- [lm-staging] removed Database Webhook trigger ${hook.name} ON ${hook.table}`);
      changes.push({ line: s.line, object: `TRIGGER ${hook.name} ON ${hook.table}`, change: 'removed (Database Webhook)' });
      continue;
    }
    if (refersToRemovedTrigger(s.text)) {
      parts.push(`-- [lm-staging] removed statement for a removed webhook trigger`);
      changes.push({ line: s.line, object: objectOf(s.text), change: 'removed (belongs to a removed webhook trigger)' });
      continue;
    }
    const before = { hosts: Object.values(hosts).reduce((a, b) => a + b, 0), redacted, prodRefs };
    const stmtHosts = new Set<string>();
    let text = s.text.replace(/(https?:\/\/)([a-z0-9.-]+)/gi, (_all, scheme: string, host: string) => {
      const h = host.toLowerCase();
      if (h !== NEUTRAL_HOST) {
        hosts[h] = (hosts[h] || 0) + 1;
        stmtHosts.add(h);
      }
      return `${scheme.toLowerCase().startsWith('http:') ? 'https://' : scheme}${NEUTRAL_HOST}`;
    });
    for (const [label, re] of SECRET_PATTERNS) {
      text = text.replace(re, (...args: string[]) => {
        redacted++;
        if (label === 'bearer token') return 'Bearer REDACTED';
        if (label === 'key/token assignment') return `${args[1]}${args[2]}${args[3]}REDACTED${args[3]}`;
        return 'REDACTED';
      });
    }
    text = text.replace(prodRe, () => {
      prodRefs++;
      return 'staging-disabled';
    });
    if (/^CREATE\s+SCHEMA\s+"?public"?\s*;$/i.test(text)) text = 'CREATE SCHEMA IF NOT EXISTS public;';
    const what: string[] = [];
    if (stmtHosts.size) what.push(`URL host ${[...stmtHosts].join(', ')} → ${NEUTRAL_HOST}`);
    if (redacted > before.redacted) what.push(`${redacted - before.redacted} secret-like value(s) redacted`);
    if (prodRefs > before.prodRefs) what.push(`${prodRefs - before.prodRefs} production ref(s) replaced`);
    if (what.length) changes.push({ line: s.line, object: objectOf(s.text), change: what.join('; ') });
    parts.push(text);
  }

  const hostList = Object.entries(hosts).map(([h, c]) => `${h}×${c}`).join(', ') || 'none';
  const header = [
    SANITIZED_HEADER,
    `-- source-sha256: ${createHash('sha256').update(input).digest('hex')}`,
    `-- removed webhook triggers: ${removed.size}`,
    `-- URL hosts rewritten to ${NEUTRAL_HOST}: ${hostList.replace(/https?:\/\//g, '')}`,
    `-- redacted secret-like values: ${redacted}; production refs replaced: ${prodRefs}`,
    ''
  ].join('\n');
  return { sql: `${header}\n${parts.join('\n\n')}\n`, changes, removedTriggers: [...removed].map(([n, t]) => `${n} ON ${t}`), hosts, redacted, prodRefs };
}

function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error('usage: npx tsx scripts/staging/sanitize-dump.ts <prod-schema.dump.sql> <staging-schema.dump.sql>');
    process.exit(2);
  }
  const repo = realpathSync(join(__dirname, '..', '..'));
  const outAbs = resolve(outPath);
  const outDir = existsSync(dirname(outAbs)) ? realpathSync(dirname(outAbs)) : '';
  const die = (m: string): never => {
    console.error(`✗ ${m}`);
    process.exit(2);
  };
  if (!outDir) die('output directory does not exist');
  if ((outDir + '/').startsWith(repo + '/')) die('output must be outside the repository');
  if (!outAbs.endsWith('.dump.sql')) die('output name must end with .dump.sql');
  if (existsSync(outAbs)) die('output already exists (refusing to overwrite)');

  let result: SanitizeResult;
  try {
    result = sanitizeSchemaDump(readFileSync(inPath, 'utf8'));
  } catch (e) {
    die(`${(e as Error).message} — nothing written`);
    return;
  }
  writeFileSync(outAbs, result.sql, { mode: 0o600, flag: 'wx' });

  const check = inspectStatements(splitSqlStatements(result.sql), PRODUCTION_SUPABASE_REF);
  if (check.dataStatements.length || needsReview(check)) {
    unlinkSync(outAbs);
    die(`sanitised copy still has findings (data ${check.dataStatements.length}, http ${check.outboundHttp.length}, prod refs ${check.productionRefs.length}, secrets ${check.secretLike.length}) — deleted`);
  }
  console.log(`✓ staging copy written: ${outAbs} (mode 600)`);
  console.log(`✓ removed Database Webhook triggers: ${result.removedTriggers.length}${result.removedTriggers.length ? ` (${result.removedTriggers.join('; ')})` : ''}`);
  console.log(`✓ URL hosts rewritten to ${NEUTRAL_HOST}: ${Object.entries(result.hosts).map(([h, c]) => `${h}×${c}`).join(', ') || 'none'}`);
  console.log(`✓ redacted secret-like values: ${result.redacted}; production refs replaced: ${result.prodRefs}`);
  console.log('✓ re-check of the copy: no data, no outbound HTTP, no production ref, no secret-like values');
  const before = findNotNull(readFileSync(inPath, 'utf8'));
  const after = findNotNull(result.sql);
  if (before.notNull && !after.notNull) {
    unlinkSync(outAbs);
    die('pickup_orders.pickup_date NOT NULL was lost in the copy — deleted');
  }
  console.log(`${after.notNull ? '✓' : '✗'} pickup_orders.pickup_date NOT NULL in the copy: ${describeNotNull(after)}`);
}

if (require.main === module) main();
