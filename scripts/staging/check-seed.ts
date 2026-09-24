/**
 * Offline check: does scripts/staging/seed.sql fit the staging schema
 * (sanitised production schema dump + PR migrations)? No database.
 *
 *   npx tsx scripts/staging/check-seed.ts ~/lm-staging/staging-schema.dump.sql
 *
 * Prints, for every table the seed writes, the problems found and that
 * table's columns (name, type, NOT NULL / DEFAULT / IDENTITY flags). Schema
 * metadata only — no data, no default expressions — safe to share.
 * Exit 0 = seed fits, 1 = mismatch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PR_MIGRATION_FILES } from './prMigrations';
import { checkSeed, describeColumns, modelFromSql, seedInserts } from './tableColumns';

const ROOT = join(__dirname, '..', '..');
const dump = process.argv[2];
if (!dump) {
  console.error('usage: npx tsx scripts/staging/check-seed.ts <staging-schema.dump.sql>');
  process.exit(2);
}
const model = modelFromSql(readFileSync(dump, 'utf8'), ...PR_MIGRATION_FILES.map((m) => readFileSync(join(ROOT, 'supabase/migrations', m), 'utf8')));
const inserts = seedInserts(readFileSync(join(ROOT, 'scripts/staging/seed.sql'), 'utf8'));
const issues = checkSeed(model, inserts);
console.log(`schema: ${model.size} tables (dump + ${PR_MIGRATION_FILES.length} PR migrations); seed: ${inserts.length} INSERT statements`);
for (const table of [...new Set(inserts.map((i) => i.table))]) {
  const mine = issues.filter((i) => i.table === table);
  console.log(`${mine.length ? '✗' : '✓'} ${table}`);
  mine.forEach((i) => console.log(`    seed.sql:${i.line}: ${i.problem}`));
  const cols = model.get(table);
  if (cols && mine.length) describeColumns(cols).forEach((c) => console.log(`      · ${c}`));
}
process.exit(issues.length ? 1 : 0);
