/**
 * Offline check of a schema dump file (no database connection).
 *
 *   npx tsx scripts/staging/check-dump.ts ~/lm-staging/prod-schema.dump.sql
 *
 * Exit 0 = clean, 1 = must be neutralised (run sanitize-dump.ts), 2 = contains
 * data or non-schema statements (never use; dump-prod-schema.sh deletes it).
 * Output shows line numbers + keyword/host only — safe to share.
 */
import { readFileSync, statSync } from 'node:fs';
import { PRODUCTION_SUPABASE_REF } from '../../lib/supabaseTarget';
import { inspectSchemaDump, needsReview } from './schemaDump';

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/staging/check-dump.ts <dump.sql>');
  process.exit(2);
}
const sql = readFileSync(file, 'utf8');
const r = inspectSchemaDump(sql, PRODUCTION_SUPABASE_REF);
const tables = (sql.match(/^CREATE TABLE /gm) || []).length;
const policies = (sql.match(/^CREATE POLICY /gm) || []).length;
const fns = (sql.match(/^CREATE (OR REPLACE )?FUNCTION /gm) || []).length;
const triggers = (sql.match(/^CREATE (OR REPLACE )?TRIGGER /gm) || []).length;
const mode = (statSync(file).mode & 0o777).toString(8);

console.log(`file: ${sql.split('\n').length} lines, permissions ${mode}${mode !== '600' ? '  ← run: chmod 600 <file>' : ''}`);
console.log(`objects: ${tables} tables, ${policies} policies, ${fns} functions, ${triggers} triggers`);
console.log(`pickup_orders.pickup_date NOT NULL: ${/CREATE TABLE public\.pickup_orders \([\s\S]*?pickup_date date NOT NULL/.test(sql) ? 'yes' : 'NOT FOUND'}`);
const section = (title: string, items: string[]) => {
  console.log(`${items.length ? '✗' : '✓'} ${title}: ${items.length}`);
  items.slice(0, 40).forEach((l) => console.log(`    ${l}`));
};
section('top-level data / non-schema statements (must be 0)', r.dataStatements);
console.log(`• DML inside function bodies (definitions, not data): ${r.functionBodyDml.length}`);
r.functionBodyDml.slice(0, 40).forEach((l) => console.log(`    ${l}`));
section('outbound HTTP / URLs (review)', r.outboundHttp);
section('production ref (review)', r.productionRefs);
section('secret-like literals (review)', r.secretLike);
console.log(`• notes: ${r.notes.length}`);
r.notes.slice(0, 40).forEach((l) => console.log(`    ${l}`));

if (r.dataStatements.length) process.exit(2);
if (needsReview(r)) {
  console.log('→ create the staging copy: npx tsx scripts/staging/sanitize-dump.ts <this file> <staging-schema.dump.sql>');
  process.exit(1);
}
process.exit(0);
