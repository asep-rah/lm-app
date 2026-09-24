import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectSchemaDump } from './schemaDump';

describe('inspectSchemaDump', () => {
  it('passes a clean schema-only dump', () => {
    const r = inspectSchemaDump('CREATE TABLE public.pickup_orders (id uuid NOT NULL, pickup_date date NOT NULL);\nALTER TABLE ONLY public.pickup_orders ADD CONSTRAINT p PRIMARY KEY (id);', 'prodref');
    assert.deepEqual(r, { dataStatements: [], outboundHttp: [], productionRefs: [] });
  });
  it('detects data, outbound HTTP and production refs', () => {
    const sql = [
      'COPY public.customers (phone, name) FROM stdin;',
      "INSERT INTO public.outlets VALUES ('x');",
      "  PERFORM net.http_post(url := 'https://prodref.supabase.co/functions/v1/notify');",
      "CREATE TRIGGER t AFTER INSERT ON public.pickup_orders FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://app.example.com/api/hook');"
    ].join('\n');
    const r = inspectSchemaDump(sql, 'prodref');
    assert.equal(r.dataStatements.length, 2);
    assert.equal(r.outboundHttp.length, 2);
    assert.equal(r.productionRefs.length, 1);
  });
});
