import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectSchemaDump, needsReview } from './schemaDump';

describe('inspectSchemaDump', () => {
  it('passes a clean schema-only dump', () => {
    const r = inspectSchemaDump(
      'CREATE TABLE public.pickup_orders (id uuid NOT NULL, pickup_date date NOT NULL);\nGRANT ALL ON TABLE public.pickup_orders TO anon;\nGRANT ALL ON TABLE public.pickup_orders TO service_role;',
      'prodref'
    );
    assert.deepEqual(r, { dataStatements: [], outboundHttp: [], productionRefs: [], secretLike: [], notes: [] });
    assert.equal(needsReview(r), false);
  });

  it('detects data, outbound HTTP, production refs and secrets without echoing their values', () => {
    const sql = [
      'COPY public.customers (phone, name) FROM stdin;',
      "INSERT INTO public.outlets VALUES ('0812345678', 'Jl. Rahasia');",
      "  PERFORM net.http_post(url := 'https://prodref.supabase.co/functions/v1/notify');",
      "CREATE TRIGGER t AFTER INSERT ON public.pickup_orders FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://app.example.com/api/hook');",
      "  v_key := 'sk_live_abcdef123456';",
      "  token = 'tok_very_secret_value'"
    ].join('\n');
    const r = inspectSchemaDump(sql, 'prodref');
    assert.deepEqual(r.dataStatements, ['line 1: COPY public.customers', 'line 2: INSERT INTO public.outlets']);
    assert.ok(r.outboundHttp.includes('line 3: URL host prodref.supabase.co'));
    assert.ok(r.outboundHttp.includes('line 4: supabase_functions.http_request'));
    assert.deepEqual(r.productionRefs, ['line 3: production ref']);
    assert.deepEqual(r.secretLike, ['line 5: sk_live', 'line 6: token']);
    const all = JSON.stringify(r);
    for (const leaked of ['0812345678', 'Rahasia', 'abcdef123456', 'very_secret']) assert.ok(!all.includes(leaked), leaked);
    assert.equal(needsReview(r), true);
  });

  it('reports extensions, extra schemas and grants to unknown roles as notes', () => {
    const r = inspectSchemaDump(
      'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\nCREATE SCHEMA reporting;\nCREATE SCHEMA public;\nGRANT SELECT ON TABLE public.x TO metabase_ro, anon;',
      'prodref'
    );
    assert.deepEqual(r.notes, ['line 1: extension pg_trgm', 'line 2: schema reporting', 'line 4: grant to non-standard role metabase_ro']);
  });
});
