import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signStaffSession, verifyStaffSession, STAFF_SESSION_TTL_SECONDS } from './core';

const SECRET = 's'.repeat(40);

describe('staff session token', () => {
  it('round-trips id and normalised role', () => {
    const t = signStaffSession({ sid: 'emp-1', role: ' Kasir ' }, SECRET, 1000);
    const p = verifyStaffSession(t, SECRET, 1001);
    assert.equal(p?.sid, 'emp-1');
    assert.equal(p?.role, 'kasir');
    assert.equal(p?.exp, 1000 + STAFF_SESSION_TTL_SECONDS);
  });
  it('rejects expired, tampered, wrong-secret and short-secret tokens', () => {
    const t = signStaffSession({ sid: 'emp-1', role: 'kasir' }, SECRET, 1000);
    assert.equal(verifyStaffSession(t, SECRET, 1000 + STAFF_SESSION_TTL_SECONDS), null);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, sid: 'emp-1', role: 'owner', iat: 1000, exp: 99999 })).toString('base64url');
    assert.equal(verifyStaffSession(`${forged}.${sig}`, SECRET, 1001), null);
    assert.equal(verifyStaffSession(`${body}.${sig}x`, SECRET, 1001), null);
    assert.equal(verifyStaffSession(t, 't'.repeat(40), 1001), null);
    assert.equal(verifyStaffSession(t, 'short', 1001), null);
    assert.equal(verifyStaffSession('', SECRET, 1001), null);
  });
  it('is not interchangeable with a customer session token', async () => {
    const { signSession } = await import('../customerAuth/core');
    const customer = signSession({ phone: '081234567890', method: 'whatsapp' }, SECRET, 1000);
    assert.equal(verifyStaffSession(customer, SECRET, 1001), null);
  });
});
