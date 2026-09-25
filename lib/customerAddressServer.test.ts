import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toSavedAddresses, validateAddressDraft } from './customerAddressServer';

describe('customer address draft (server)', () => {
  it('valid draft with pin; client-only ids become new rows', () => {
    const r = validateAddressDraft({ id: 'local_0811', label: ' Rumah ', full_address: 'Jl  Dago,  No. 1', latitude: '-6.88', longitude: 107.61, is_primary: true });
    assert.equal(r.ok, true);
    const d = (r as { draft: Record<string, unknown> }).draft;
    assert.deepEqual(d, { id: null, label_name: 'Rumah', full_address: 'Jl Dago, No. 1', is_primary: true, latitude: -6.88, longitude: 107.61 });
  });
  it('keeps a real uuid; no pin is allowed', () => {
    const id = '2a000000-0000-4000-8000-00000000000a';
    const r = validateAddressDraft({ id, full_address: 'Jl Dago No. 1' });
    assert.deepEqual((r as { draft: Record<string, unknown> }).draft, {
      id,
      label_name: 'Alamat',
      full_address: 'Jl Dago No. 1',
      is_primary: false,
      latitude: null,
      longitude: null
    });
  });
  it('rejects short address, half / invalid pin, garbage', () => {
    for (const bad of [{ full_address: 'Jl' }, { full_address: 'Jl Dago 1', latitude: 1 }, { full_address: 'Jl Dago 1', latitude: 0, longitude: 0 }, null, 'x']) {
      assert.equal(validateAddressDraft(bad).ok, false, JSON.stringify(bad));
    }
  });
  it('lists oldest first with exactly one primary', () => {
    const rows = [
      { id: 'b', label_name: 'Kantor', full_address: 'B', is_primary: true, created_at: '2026-02-01' },
      { id: 'a', label_name: null, full_address: 'A', is_primary: true, latitude: '-6.8', longitude: '107.6', created_at: '2026-01-01' },
      { id: 'c', full_address: '', created_at: '2026-03-01' }
    ];
    assert.deepEqual(toSavedAddresses(rows), [
      { id: 'a', label: 'Alamat', full_address: 'A', is_primary: true, latitude: -6.8, longitude: 107.6 },
      { id: 'b', label: 'Kantor', full_address: 'B', is_primary: false, latitude: null, longitude: null }
    ]);
    assert.deepEqual(toSavedAddresses([]), []);
  });
});
