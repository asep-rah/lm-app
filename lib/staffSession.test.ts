import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { homePathForRole, isWorkspaceRole } from './staffSession';

describe('homePathForRole — tidak pernah loop ke /login untuk role yang dikenal', () => {
  it('role utama ke halamannya', () => {
    assert.equal(homePathForRole('owner'), '/owner');
    assert.equal(homePathForRole('kasir'), '/pos');
    assert.equal(homePathForRole('POS'), '/pos');
    assert.equal(homePathForRole('cs'), '/cs/workspace');
    assert.equal(homePathForRole('driver'), '/driver');
    assert.equal(homePathForRole('investor'), '/investor');
  });

  it('supervisor, admin ops, finance, head, dst. → /workspace (dulu /login → refresh tanpa henti)', () => {
    for (const r of ['supervisor', 'admin_ops', 'admin', 'finance', 'head_finance', 'owner_relation', 'digital_marketing', 'head', 'head_management', ' Supervisor ']) {
      assert.equal(homePathForRole(r), '/workspace', r);
    }
  });

  it('setiap role workspace punya tujuan selain /login', () => {
    for (const r of ['admin_ops', 'admin', 'digital_marketing', 'finance', 'head_finance', 'owner_relation', 'cs', 'head_cs', 'supervisor', 'head', 'head_management']) {
      assert.ok(isWorkspaceRole(r));
      assert.notEqual(homePathForRole(r), '/login', r);
    }
  });

  it('role tidak dikenal / kosong → /login (halaman login yang menangani, tanpa redirect)', () => {
    assert.equal(homePathForRole(''), '/login');
    assert.equal(homePathForRole('tamu'), '/login');
  });
});
