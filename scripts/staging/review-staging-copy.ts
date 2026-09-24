/**
 * Review a staging copy against the production schema dump it came from
 * (offline, no database). Proves the copy is EXACTLY the sanitizer output of
 * that dump (no hand edits slipped in) and lists every change by object name
 * and line — never statement contents.
 *
 *   npx tsx scripts/staging/review-staging-copy.ts ~/lm-staging/prod-schema.dump.sql ~/lm-staging/staging-schema.dump.sql
 */
import { readFileSync } from 'node:fs';
import { PRODUCTION_SUPABASE_REF } from '../../lib/supabaseTarget';
import { sanitizeSchemaDump } from './sanitize-dump';
import { describeNotNull, findNotNull } from './columnNotNull';
import { inspectSchemaDump, needsReview } from './schemaDump';

const [prodPath, stagingPath] = process.argv.slice(2);
if (!prodPath || !stagingPath) {
  console.error('usage: npx tsx scripts/staging/review-staging-copy.ts <prod-schema.dump.sql> <staging-schema.dump.sql>');
  process.exit(2);
}
const expected = sanitizeSchemaDump(readFileSync(prodPath, 'utf8'));
const actual = readFileSync(stagingPath, 'utf8');
if (actual !== expected.sql) {
  console.error('✗ the staging copy is NOT the sanitizer output of this production dump (edited, or a different dump). Re-create it with sanitize-dump.ts.');
  process.exit(1);
}
console.log('✓ staging copy = sanitizer output of this production dump (byte-identical)');
const r = inspectSchemaDump(actual, PRODUCTION_SUPABASE_REF);
console.log(`✓ re-check: data ${r.dataStatements.length}, outbound HTTP ${r.outboundHttp.length}, production refs ${r.productionRefs.length}, secret-like ${r.secretLike.length}, foreign default privileges ${r.foreignDefaultPrivileges.length}`);
if (r.dataStatements.length || needsReview(r)) process.exit(1);
const nn = findNotNull(actual);
console.log(`${nn.notNull ? '✓' : '✗'} pickup_orders.pickup_date NOT NULL: ${describeNotNull(nn)}`);
if (!nn.notNull) process.exit(1);
console.log(`• changes (${expected.changes.length}), line numbers refer to the production dump:`);
for (const c of expected.changes) console.log(`    line ${c.line}: ${c.object} — ${c.change}`);
console.log(`• function bodies with DML (definitions, not data): ${r.functionBodyDml.length}`);
r.functionBodyDml.forEach((l) => console.log(`    ${l}`));
