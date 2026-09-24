import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serverTableNeeds } from './service-role-needs';

describe('serverTableNeeds', () => {
  it('collects table + operation from server code, skips browser files and storage', () => {
    const needs = serverTableNeeds([
      { path: 'app/api/a/route.ts', text: "const { data } = await db.from('deposit_topups').select('*').eq('id', x);\nawait db.from('customers').update({ a: 1 }).eq('phone', p);\nawait db.storage.from('satuan-item-photos').list('x');" },
      { path: 'lib/x.ts', text: "await insertAttempts(db, 'deposit_topups', [{}]);\nawait insertFirst(db, 'pickup_orders', rows);\nawait db.from('customers').upsert({});" },
      { path: 'lib/browser.ts', text: "import { supabase } from '@/lib/supabaseClient';\nawait supabase.from('secret_table').delete();" }
    ]);
    const view = Object.fromEntries([...needs].map(([t, n]) => [t, [...n.privileges].sort().join(',')]));
    assert.deepEqual(view, { deposit_topups: 'INSERT,SELECT', customers: 'INSERT,UPDATE', pickup_orders: 'INSERT' });
  });
});
