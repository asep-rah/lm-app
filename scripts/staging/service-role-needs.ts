/**
 * Offline: which table privileges does the SERVER code need as service_role,
 * and which of them does the production schema (staging copy + PR
 * migrations) not grant? No database.
 *
 *   npx tsx scripts/staging/service-role-needs.ts ~/lm-staging/staging-schema.dump.sql
 *
 * Server code = app/api/** plus lib/** files that do not import the browser
 * client (@/lib/supabaseClient). Each .from('<table>') is paired with the
 * first .select/.insert/.update/.delete/.upsert that follows it. Heuristic,
 * so it over-reports rather than misses; storage .from() is ignored.
 * Output: table names and privilege names only — safe to share.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PR_MIGRATION_FILES } from './prMigrations';
import { tableMeta } from './describe-tables';

const ROOT = join(__dirname, '..', '..');
const OPS: Record<string, string[]> = { select: ['SELECT'], insert: ['INSERT'], update: ['UPDATE'], delete: ['DELETE'], upsert: ['INSERT', 'UPDATE'] };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

export type Need = { table: string; privileges: Set<string>; files: Set<string> };

export function serverTableNeeds(files: Array<{ path: string; text: string }>): Map<string, Need> {
  const needs = new Map<string, Need>();
  for (const { path, text } of files) {
    if (/from\s+['"]@\/lib\/supabaseClient['"]/.test(text)) continue; // browser code (anon key)
    for (const m of text.matchAll(/(\.storage\s*)?\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)/g)) {
      if (m[1]) continue;
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 400);
      const op = /\.(select|insert|update|delete|upsert)\s*\(/.exec(after)?.[1];
      if (!op) continue;
      const n = needs.get(m[2]) ?? { table: m[2], privileges: new Set<string>(), files: new Set<string>() };
      OPS[op].forEach((p) => n.privileges.add(p));
      n.files.add(path);
      needs.set(m[2], n);
    }
    // Helpers that take the table name as an argument (server variants take a db first).
    const HELPERS: Record<string, string> = { insertFirst: 'insert', insertAttempts: 'insert', insertWithFallback: 'insert', updateWithFallback: 'update', safeSelect: 'select' };
    for (const m of text.matchAll(/\b(insertFirst|insertAttempts|insertWithFallback|updateWithFallback|safeSelect)\(\s*(?:[A-Za-z_]\w*\s*,\s*)?['"]([a-z_][a-z0-9_]*)['"]/g)) {
      const n = needs.get(m[2]) ?? { table: m[2], privileges: new Set<string>(), files: new Set<string>() };
      OPS[HELPERS[m[1]]].forEach((p) => n.privileges.add(p));
      n.files.add(path);
      needs.set(m[2], n);
    }
  }
  return needs;
}

function main() {
  const dump = process.argv[2];
  if (!dump) {
    console.error('usage: npx tsx scripts/staging/service-role-needs.ts <staging-schema.dump.sql>');
    process.exit(2);
  }
  const files = [...walk(join(ROOT, 'app', 'api')), ...walk(join(ROOT, 'lib'))].map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
  const needs = serverTableNeeds(files);
  const sqls = [readFileSync(dump, 'utf8'), ...PR_MIGRATION_FILES.map((m) => readFileSync(join(ROOT, 'supabase/migrations', m), 'utf8'))];
  const meta = tableMeta(sqls);
  let missingTotal = 0;
  const rows = [...needs.values()].sort((a, b) => a.table.localeCompare(b.table));
  for (const n of rows) {
    const acl = meta.acl.get(`TABLE public.${n.table}`);
    const held = new Set([...(acl?.get('service_role') ?? []), ...(acl?.get('public') ?? [])]);
    const missing = [...n.privileges].filter((p) => !held.has('ALL') && !held.has(p));
    missingTotal += missing.length;
    const exists = meta.acl.has(`TABLE public.${n.table}`) || sqls.some((s) => new RegExp(`CREATE TABLE (IF NOT EXISTS )?(public\\.)?"?${n.table}"?\\b`, 'i').test(s));
    const status = !exists ? '? table not in schema' : missing.length ? `✗ missing ${missing.join(', ')}` : '✓';
    console.log(`${status.padEnd(34)} ${n.table} (needs ${[...n.privileges].join(', ')}; has ${[...held].join(',') || 'none'}) — ${[...n.files].slice(0, 3).join(', ')}${n.files.size > 3 ? ', …' : ''}`);
  }
  console.log(`\n${rows.length} tables used by server code; ${missingTotal} missing service_role privilege(s)`);
  process.exit(missingTotal ? 1 : 0);
}

if (require.main === module) main();
