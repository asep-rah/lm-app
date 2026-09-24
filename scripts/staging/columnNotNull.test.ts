import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { describeNotNull, findNotNull } from './columnNotNull';
import { sanitizeSchemaDump } from './sanitize-dump';

const fixture = (f: string) => readFileSync(join(__dirname, 'fixtures', f), 'utf8');
const table = (cols: string, extra = '') => `CREATE TABLE public.pickup_orders (\n    id uuid NOT NULL,\n${cols}\n);\n${extra}`;

describe('findNotNull — real pg_dump 18 output (server 17)', () => {
  it('column added nullable, then SET NOT NULL → dumped inline', () => {
    const f = findNotNull(fixture('pgdump18-pickup-alter.sql'));
    assert.equal(f.notNull, true);
    assert.equal(f.type, 'date');
  });
  it('with DEFAULT CURRENT_DATE between type and NOT NULL (the NOT FOUND case)', () => {
    const f = findNotNull(fixture('pgdump18-pickup-default.sql'));
    assert.equal(f.notNull, true);
    assert.equal(f.hasDefault, true);
    assert.match(describeNotNull(f), /^yes — column definition NOT NULL \(with DEFAULT\); type date$/);
  });
  it('the sanitised staging copy keeps the constraint', () => {
    assert.equal(findNotNull(sanitizeSchemaDump(fixture('pgdump18-pickup-default.sql')).sql).notNull, true);
    assert.equal(findNotNull(sanitizeSchemaDump(fixture('pgdump-schema-only.sql')).sql).notNull, true);
  });
});

describe('findNotNull — positive forms', () => {
  const yes = (sql: string) => assert.equal(findNotNull(sql).notNull, true, sql);
  it('recognises every way a dump can declare it', () => {
    yes(table('    pickup_date date NOT NULL'));
    yes(table("    pickup_date date DEFAULT ('now'::text)::date NOT NULL"));
    yes(table('    pickup_date timestamp with time zone DEFAULT now() NOT NULL'));
    yes(table('    "pickup_date" date NOT NULL'));
    yes(table('    pickup_date date CONSTRAINT pickup_orders_pickup_date_not_null NOT NULL'));
    yes(table('    pickup_date date COLLATE "C" NOT NULL'.replace('date COLLATE "C"', 'text COLLATE "C"')));
    yes(table('    pickup_date date,\n    CONSTRAINT pickup_orders_pickup_date_not_null NOT NULL pickup_date'));
    yes(table('    pickup_date date', 'ALTER TABLE ONLY public.pickup_orders ALTER COLUMN pickup_date SET NOT NULL;'));
    yes(table('    pickup_date date', 'ALTER TABLE public.pickup_orders ADD CONSTRAINT pd_nn NOT NULL pickup_date;'));
    yes(`CREATE TABLE pickup_orders (\n    pickup_date date NOT NULL\n);`);
  });
});

describe('findNotNull — negative forms (must not be fooled)', () => {
  it('nullable column, even with a DEFAULT', () => {
    const f = findNotNull(table('    pickup_date date DEFAULT CURRENT_DATE,\n    status text NOT NULL'));
    assert.equal(f.notNull, false);
    assert.match(describeNotNull(f), /^NO — column exists \(type date, has DEFAULT\) but is nullable$/);
  });
  it('"NOT NULL" inside a string, comment or expression does not count', () => {
    assert.equal(findNotNull(table("    pickup_date text DEFAULT 'NOT NULL'")).notNull, false);
    assert.equal(findNotNull(table('    pickup_date date -- NOT NULL\n    , status text')).notNull, false);
    assert.equal(findNotNull(table('    pickup_date boolean DEFAULT (1 IS NOT NULL)')).notNull, false);
  });
  it('a CHECK (pickup_date IS NOT NULL) is reported but not counted', () => {
    const f = findNotNull(table('    pickup_date date,\n    CONSTRAINT pd_check CHECK ((pickup_date IS NOT NULL))'));
    assert.equal(f.notNull, false);
    assert.equal(f.checkOnly, true);
  });
  it('NOT NULL on another column or another table does not count', () => {
    assert.equal(findNotNull(table('    pickup_date date,\n    pickup_time time NOT NULL')).notNull, false);
    const other = `CREATE TABLE public.transactions (\n    pickup_date date NOT NULL\n);\nCREATE TABLE public.pickup_orders (\n    pickup_date date\n);`;
    assert.equal(findNotNull(other).notNull, false);
    assert.equal(findNotNull('CREATE TABLE archive.pickup_orders (\n    pickup_date date NOT NULL\n);').tableFound, false);
  });
  it('SET NOT NULL on another column or table does not count; DROP NOT NULL is not SET', () => {
    assert.equal(findNotNull(table('    pickup_date date', 'ALTER TABLE ONLY public.pickup_orders ALTER COLUMN pickup_time SET NOT NULL;')).notNull, false);
    assert.equal(findNotNull(table('    pickup_date date', 'ALTER TABLE ONLY public.transactions ALTER COLUMN pickup_date SET NOT NULL;')).notNull, false);
    assert.equal(findNotNull(table('    pickup_date date', 'ALTER TABLE ONLY public.pickup_orders ALTER COLUMN pickup_date DROP NOT NULL;')).notNull, false);
  });
  it('missing table / column are reported as such', () => {
    assert.match(describeNotNull(findNotNull('CREATE TABLE public.outlets (id uuid);')), /table public\.pickup_orders is not in the dump/);
    assert.match(describeNotNull(findNotNull(table('    status text'))), /column pickup_date is not in public\.pickup_orders/);
  });
});
