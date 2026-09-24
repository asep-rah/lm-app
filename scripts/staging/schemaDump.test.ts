import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inspectSchemaDump, needsReview } from './schemaDump';
import { splitSqlStatements } from './sqlLexer';

const PROD = 'prodref0000000000000';
const fixture = (f: string) => readFileSync(join(__dirname, 'fixtures', f), 'utf8');

describe('sqlLexer', () => {
  it('does not split on semicolons inside bodies, strings, identifiers or comments', () => {
    const sql = [
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.t VALUES (1); DELETE FROM public.t; END $$;",
      "CREATE FUNCTION public.g() RETURNS text LANGUAGE sql AS $body$ SELECT 'a;b' $body$;",
      "COMMENT ON TABLE public.t IS 'x; INSERT INTO public.t VALUES (2)';",
      "COMMENT ON COLUMN public.t.\"we;ird\" IS E'it\\'s; fine';",
      '/* block; /* nested; */ still comment */ CREATE TABLE public.u (id int);',
      "-- line comment; INSERT INTO public.t VALUES (3)\nCREATE VIEW public.v AS SELECT 1;"
    ].join('\n');
    const s = splitSqlStatements(sql);
    assert.equal(s.length, 6);
    assert.ok(s.every((x) => x.kind === 'sql'));
    assert.match(s[4].text, /^CREATE TABLE/);
    assert.equal(s[5].line, 7);
  });

  it('keeps BEGIN ATOMIC bodies together', () => {
    const s = splitSqlStatements('CREATE FUNCTION public.h() RETURNS void LANGUAGE sql BEGIN ATOMIC INSERT INTO public.t VALUES (1); UPDATE public.t SET id = 2; END;\nCREATE TABLE public.z (id int);');
    assert.equal(s.length, 2);
    assert.match(s[0].text, /END;$/);
  });

  it('recognises psql meta-commands and COPY data blocks', () => {
    const s = splitSqlStatements('\\restrict abc123\nCOPY public.t (id, note) FROM stdin;\n1\tsemi;colon\n2\tx\n\\.\n\n\\unrestrict abc123\n');
    assert.deepEqual(s.map((x) => x.kind), ['meta', 'sql', 'copydata', 'meta']);
  });
});

describe('inspectSchemaDump — real pg_dump output', () => {
  it('schema-only dump: function-body DML is a definition, not data; service_role role check is not a secret', () => {
    const r = inspectSchemaDump(fixture('pgdump-schema-only.sql'), PROD);
    assert.deepEqual(r.dataStatements, []);
    assert.equal(r.functionBodyDml.length, 2);
    assert.match(r.functionBodyDml.join(' '), /credit_customer_deposit → INSERT INTO deposit_payment_credits, INSERT INTO customers/);
    // Only the Bearer token in the webhook headers; the 'service_role' role check is not a secret.
    assert.deepEqual(r.secretLike.map((l) => l.replace(/^line \d+: /, '')), ['bearer token']);
    assert.ok(r.outboundHttp.some((l) => /Database Webhook trigger n8n_new_order ON public\.pickup_orders/.test(l)));
    assert.ok(r.outboundHttp.some((l) => /URL host hooks\.example-n8n\.test/.test(l)));
    assert.ok(r.outboundHttp.some((l) => /net\.http_post/.test(l)));
    assert.equal(needsReview(r), true);
  });

  it('dump with data (COPY): blocked', () => {
    const r = inspectSchemaDump(fixture('pgdump-with-data.sql'), PROD);
    assert.ok(r.dataStatements.some((l) => /COPY public\.customers/.test(l)));
    assert.ok(r.dataStatements.some((l) => /COPY data block/.test(l)));
  });
});

describe('inspectSchemaDump — positive cases (must flag)', () => {
  const data = (sql: string) => inspectSchemaDump(sql, PROD).dataStatements;
  it('flags every kind of top-level data statement', () => {
    assert.deepEqual(data("INSERT INTO public.customers (phone) VALUES ('0812');"), ['line 1: INSERT INTO public.customers']);
    assert.equal(data("  insert into customers values ('x');").length, 1);
    assert.equal(data("UPDATE public.customers SET name = 'x';").length, 1);
    assert.equal(data('DELETE FROM public.customers;').length, 1);
    assert.equal(data('TRUNCATE public.customers;').length, 1);
    assert.equal(data("SELECT pg_catalog.setval('public.seq', 42, true);").length, 1);
    assert.equal(data("DO $$ BEGIN INSERT INTO public.customers VALUES ('x'); END $$;").length, 1);
    assert.equal(data("WITH x AS (SELECT 1) INSERT INTO public.customers SELECT 'y' FROM x;").length, 1);
    assert.equal(data('CALL public.load_data();').length, 1);
    assert.equal(data('SELECT * FROM public.customers;').length, 1);
    assert.equal(data('VACUUM public.customers;').length, 1);
    assert.equal(data('\\! rm -rf /\n').length, 1);
    assert.equal(data('\\copy public.customers from data.csv\n').length, 1);
  });
  it('flags a top-level INSERT placed right after a function definition', () => {
    const sql = "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.a VALUES (1); END $$;\nINSERT INTO public.customers VALUES ('0812');";
    const r = inspectSchemaDump(sql, PROD);
    assert.deepEqual(r.dataStatements, ['line 2: INSERT INTO public.customers']);
    assert.equal(r.functionBodyDml.length, 1);
  });
  it('flags outbound HTTP, secrets and the production ref', () => {
    const r = inspectSchemaDump(
      [
        "CREATE TRIGGER hook AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://hooks.example.com/x', 'POST', '{}', '{}', '1000');",
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM net.http_post(url := current_setting('app.hook_url')); END $$;",
        "CREATE FUNCTION public.g() RETURNS text LANGUAGE sql AS $$ SELECT 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefgh' $$;",
        "COMMENT ON FUNCTION public.g() IS 'uses sb_secret_abcdefgh12345 and Bearer abcdefghijklmnop';",
        `CREATE FUNCTION public.h() RETURNS text LANGUAGE sql AS $$ SELECT '{"apikey":"abcdefghijklmnopqrstu"}' $$;`,
        `COMMENT ON SCHEMA public IS 'see https://${PROD}.supabase.co';`
      ].join('\n'),
      PROD
    );
    assert.ok(r.outboundHttp.some((l) => /Database Webhook trigger hook ON public\.t/.test(l)));
    assert.ok(r.outboundHttp.some((l) => /net\.http_post \(dynamic target\)/.test(l)));
    assert.deepEqual(r.secretLike.map((l) => l.replace(/^line \d+: /, '')).sort(), ['bearer token', 'jwt', 'key/token assignment', 'sb_secret'].sort());
    assert.ok(r.productionRefs.length >= 1);
    const all = JSON.stringify(r);
    for (const leaked of ['abcdefgh12345', 'abcdefghijklmnop', 'abcdefghijklmnopqrstu']) assert.ok(!all.includes(leaked), leaked);
  });
});

describe('inspectSchemaDump — negative cases (must not flag)', () => {
  it('accepts a clean schema: definitions with DML, role checks, grants, meta restrict, neutral URLs', () => {
    const sql = [
      '\\restrict AbC123',
      "SET statement_timeout = 0;",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      'CREATE TABLE public.employees (id uuid NOT NULL, password text, token text);',
      "COMMENT ON COLUMN public.employees.password IS 'scrypt hash, never plaintext';",
      "CREATE POLICY p ON public.employees USING ((auth.role() = 'service_role'::text));",
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN INSERT INTO public.employees (id) VALUES (gen_random_uuid()); UPDATE public.employees SET token = NULL; END $fn$;",
      "CREATE FUNCTION public.n() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM net.http_post(url := 'https://staging-disabled.invalid/x'); END $$;",
      'GRANT ALL ON TABLE public.employees TO service_role;',
      'ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);',
      '\\unrestrict AbC123'
    ].join('\n');
    const r = inspectSchemaDump(sql, PROD);
    assert.deepEqual(r.dataStatements, []);
    assert.deepEqual(r.outboundHttp, []);
    assert.deepEqual(r.secretLike, []);
    assert.deepEqual(r.productionRefs, []);
    assert.equal(needsReview(r), false);
    assert.equal(r.functionBodyDml.length, 1);
  });
});
