import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SANITIZED_HEADER, sanitizeSchemaDump } from './sanitize-dump';
import { inspectSchemaDump, needsReview } from './schemaDump';

const PROD = 'prodref0000000000000';
const fixture = (f: string) => readFileSync(join(__dirname, 'fixtures', f), 'utf8');

describe('sanitizeSchemaDump', () => {
  it('real pg_dump schema: removes the webhook, neutralises URLs, keeps definitions, result is clean', () => {
    const input = fixture('pgdump-schema-only.sql');
    const out = sanitizeSchemaDump(input, PROD);
    assert.ok(out.sql.startsWith(SANITIZED_HEADER + '\n'));
    assert.deepEqual(out.removedTriggers, ['n8n_new_order ON public.pickup_orders']);
    assert.ok(!/supabase_functions\.http_request\s*\(/.test(out.sql));
    assert.ok(!out.sql.includes('https://hooks.example-n8n.test'));
    assert.ok(!out.sql.includes('FixtureTokenAbcdefghijklmnop123'));
    assert.match(out.sql, /net\.http_post\(url := 'https:\/\/staging-disabled\.invalid\/webhook\/ops'/);
    assert.match(out.sql, /CREATE FUNCTION public\.credit_customer_deposit/);
    assert.match(out.sql, /pickup_date date NOT NULL/);
    assert.match(out.sql, /'service_role'::text/);
    const r = inspectSchemaDump(out.sql, PROD);
    assert.deepEqual(r.dataStatements, []);
    assert.equal(needsReview(r), false);
  });

  it('refuses input with data (COPY or INSERT) — nothing produced', () => {
    assert.throws(() => sanitizeSchemaDump(fixture('pgdump-with-data.sql'), PROD), /data or non-schema statements/);
    assert.throws(() => sanitizeSchemaDump("CREATE TABLE public.t (id int);\nINSERT INTO public.t VALUES (1);", PROD), /INSERT INTO public\.t/);
  });

  it('removes statements tied to a removed webhook trigger; keeps other triggers', () => {
    const out = sanitizeSchemaDump(
      [
        "CREATE TRIGGER \"Hook\" AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://x.example.com', 'POST', '{\"Authorization\":\"Bearer abcdefghijklmnop\"}', '{}', '1000');",
        'ALTER TABLE public.t DISABLE TRIGGER "Hook";',
        "COMMENT ON TRIGGER \"Hook\" ON public.t IS 'n8n';",
        'CREATE TRIGGER keep_me BEFORE UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION public.touch();'
      ].join('\n'),
      PROD
    );
    assert.deepEqual(out.removedTriggers, ['hook ON public.t']);
    assert.ok(!/DISABLE TRIGGER|COMMENT ON TRIGGER|abcdefghijklmnop|x\.example\.com/.test(out.sql.replace(/^--.*$/gm, '')));
    assert.match(out.sql, /CREATE TRIGGER keep_me/);
  });

  it('redacts secrets and the production ref inside kept definitions', () => {
    const out = sanitizeSchemaDump(
      [
        "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM net.http_post(url := 'http://api.example.com/v1', headers := '{\"Authorization\":\"Bearer abcdefghijklmnop\",\"apikey\":\"abcdefghijklmnopqrstu\"}'::jsonb); END $$;",
        "CREATE FUNCTION public.g() RETURNS text LANGUAGE sql AS $$ SELECT 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefgh' $$;",
        `COMMENT ON SCHEMA public IS 'project ${PROD}';`,
        'CREATE SCHEMA public;'
      ].join('\n'),
      PROD
    );
    const code = out.sql.replace(/^--.*$/gm, '');
    assert.ok(!/abcdefghijklmnop|eyJhbGci|api\.example\.com/.test(code));
    assert.ok(!/abcdefghijklmnop|eyJhbGci/.test(out.sql), 'secrets never appear, not even in the header');
    assert.match(out.sql, /^-- URL hosts rewritten to staging-disabled\.invalid: api\.example\.com×1$/m);
    assert.match(out.sql, /Bearer REDACTED/);
    assert.match(out.sql, /"apikey":"REDACTED"/);
    assert.match(out.sql, /url := 'https:\/\/staging-disabled\.invalid\/v1'/);
    assert.ok(!out.sql.includes(PROD));
    assert.match(out.sql, /CREATE SCHEMA IF NOT EXISTS public;/);
    assert.equal(needsReview(inspectSchemaDump(out.sql, PROD)), false);
  });

  it('a call with a dynamic target stays flagged after sanitising (needs a human decision)', () => {
    const out = sanitizeSchemaDump("CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM net.http_post(url := current_setting('app.hook')); END $$;", PROD);
    assert.equal(needsReview(inspectSchemaDump(out.sql, PROD)), true);
  });
});
