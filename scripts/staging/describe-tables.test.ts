import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { serviceRoleGaps, tableMeta } from './describe-tables';
import { defaultKindOf, describeColumns, modelFromSql } from './tableColumns';

/** Real pg_dump of: pickup_orders.id DEFAULT nextval(pickup_order_seq), sequence granted to anon/authenticated only. */
const dump = readFileSync(join(__dirname, 'fixtures', 'pgdump16-sequence-acl.sql'), 'utf8');

describe('describe-tables', () => {
  it('classifies defaults without exposing values', () => {
    assert.equal(defaultKindOf("nextval('public.pickup_order_seq'::regclass)"), 'nextval(public.pickup_order_seq)');
    assert.equal(defaultKindOf("'Menunggu Kurir'::text"), 'literal');
    assert.equal(defaultKindOf('now()'), 'now()');
    assert.equal(defaultKindOf('gen_random_uuid()'), 'gen_random_uuid()');
    assert.equal(defaultKindOf("(now() AT TIME ZONE 'Asia/Jakarta'::text)"), 'expression');
  });
  it('reads columns, RLS, policies and sequence grants from real pg_dump output', () => {
    const model = modelFromSql(dump);
    assert.deepEqual(describeColumns(model.get('public.pickup_orders')!), [
      'id bigint NOT NULL DEFAULT nextval(public.pickup_order_seq)',
      'customer_phone text',
      'pickup_date timestamp with time zone NOT NULL',
      'status text DEFAULT literal',
      'created_at timestamp with time zone DEFAULT now()'
    ]);
    assert.equal(model.get('public.error_logs')!.get('id')!.defaultKind, 'nextval(public.error_logs_id_seq)');
    const meta = tableMeta([dump]);
    assert.ok(meta.rls.has('public.pickup_orders'));
    assert.deepEqual(meta.policies.get('public.pickup_orders'), ['anon insert [INSERT] → anon', 'anon_read [SELECT] → anon, authenticated']);
    const seq = meta.acl.get('SEQUENCE public.pickup_order_seq')!;
    assert.deepEqual([...seq.keys()].sort(), ['anon', 'authenticated']);
    assert.ok(!seq.has('service_role'), 'service_role has no USAGE on the sequence');
    assert.ok(!/Menunggu Kurir/.test(describeColumns(model.get('public.pickup_orders')!).join()), 'default values are not printed');
  });
  it('lists tables without any service_role privilege', () => {
    const sql = 'CREATE TABLE public.a (id int);\nCREATE TABLE public.b (id int);\nALTER TABLE public.b ENABLE ROW LEVEL SECURITY;\nGRANT ALL ON TABLE public.a TO anon;\nGRANT ALL ON TABLE public.b TO service_role;';
    assert.deepEqual(serviceRoleGaps(modelFromSql(sql), tableMeta([sql])), ['public.a — anon: ALL; RLS off']);
  });
  it('tables created after ALTER DEFAULT PRIVILEGES FOR ROLE postgres inherit its grants', () => {
    const dumpPart = 'CREATE TABLE public.old (id int);\nGRANT ALL ON TABLE public.old TO anon;\nALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;\nALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;';
    const migration = 'create table if not exists public.fresh (id int);';
    assert.deepEqual(serviceRoleGaps(modelFromSql(dumpPart, migration), tableMeta([dumpPart, migration])), ['public.old — anon: ALL; RLS off']);
  });
  it('applies REVOKE after GRANT', () => {
    const m = tableMeta(['GRANT ALL ON TABLE public.t TO anon;', 'GRANT SELECT ON TABLE public.t TO authenticated;', 'REVOKE ALL ON TABLE public.t FROM anon;']);
    assert.deepEqual([...m.acl.get('TABLE public.t')!].map(([r, p]) => `${r}:${[...p]}`), ['authenticated:SELECT']);
  });
});
