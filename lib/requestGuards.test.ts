import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMemoryRateLimiter, isSameOriginRequest } from './requestGuards';

describe('isSameOriginRequest', () => {
  it('accepts matching origin/host and rejects missing or foreign origins', () => {
    assert.ok(isSameOriginRequest(new Headers({ origin: 'https://app.example.com', host: 'app.example.com' })));
    assert.ok(
      isSameOriginRequest(new Headers({ origin: 'https://app.example.com', host: 'internal:3000', 'x-forwarded-host': 'app.example.com' }))
    );
    assert.equal(isSameOriginRequest(new Headers({ host: 'app.example.com' })), false);
    assert.equal(isSameOriginRequest(new Headers({ origin: 'https://evil.example', host: 'app.example.com' })), false);
    assert.equal(isSameOriginRequest(new Headers({ origin: 'null', host: 'app.example.com' })), false);
  });
});

describe('createMemoryRateLimiter', () => {
  it('allows max hits per window per key, then recovers', () => {
    const allow = createMemoryRateLimiter({ max: 2, windowMs: 1000 });
    assert.ok(allow('a', 0));
    assert.ok(allow('a', 10));
    assert.equal(allow('a', 20), false);
    assert.ok(allow('b', 20));
    assert.ok(allow('a', 1011));
  });
});
