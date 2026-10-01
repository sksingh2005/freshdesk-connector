import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FreshdeskClient, FreshdeskError } from '../src/freshdeskClient.js';
import { startMock } from './mockFreshdesk.js';

const cfg = (baseUrl, overrides = {}) => ({
  domain: 'testco', apiKey: 'testkey', baseUrl, timeoutMs: 5000, maxRetries: 2, ...overrides,
});

describe('freshdesk client', () => {
  let mock;
  before(async () => { mock = await startMock({ apiKey: 'testkey' }); });
  after(async () => { await mock.close(); });

  it('builds the Basic auth header correctly and never logs the key', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    assert.equal(client.getAuthHeader(), `Basic ${Buffer.from('testkey:X').toString('base64')}`);
    const logs = [];
    const orig = console.error;
    console.error = (...a) => logs.push(a.join(' '));
    try {
      mock.setBehavior('normal'); mock.reset();
      await client.listTickets({ page: 1, perPage: 2 });
    } finally { console.error = orig; }
    assert.ok(!logs.join('\n').includes('testkey'), 'API key leaked into logs');
    const sent = mock.requests.at(-1).auth;
    assert.equal(sent, `Basic ${Buffer.from('testkey:X').toString('base64')}`);
  });

  it('pagination: full middle page hasMore=true, partial last page hasMore=false', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    mock.setBehavior('normal'); mock.reset();
    const middle = await client.listTickets({ page: 1, perPage: 2 });
    assert.equal(middle.items.length, 2);
    assert.equal(middle.hasMore, true);
    const last = await client.listTickets({ page: 2, perPage: 2 });
    assert.equal(last.items.length, 1);
    assert.equal(last.hasMore, false);
  });

  it('429 triggers a wait of at least Retry-After then succeeds', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    mock.setBehavior('rate-once'); mock.reset();
    const start = Date.now();
    const out = await client.listTickets({ page: 1, perPage: 2 });
    const elapsed = Date.now() - start;
    assert.ok(Array.isArray(out.items));
    assert.ok(elapsed >= 900, `expected >= ~1000ms wait, got ${elapsed}ms`);
  });

  it('permanent 429 stops after MAX_RETRIES and throws RATE_LIMITED', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl, { maxRetries: 2 }));
    mock.setBehavior('rate-always'); mock.reset();
    await assert.rejects(client.listTickets({ page: 1, perPage: 2 }), (e) => {
      assert.ok(e instanceof FreshdeskError);
      assert.equal(e.code, 'RATE_LIMITED');
      return true;
    });
    assert.equal(mock.requests.length, 3); // initial + 2 retries
  });

  it('401 throws AUTH_FAILED and is not retried', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl, { apiKey: 'wrong' }));
    mock.setBehavior('normal'); mock.reset();
    await assert.rejects(client.listTickets(), (e) => e.code === 'AUTH_FAILED');
    assert.equal(mock.requests.length, 1);
  });

  it('404 throws NOT_FOUND', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    mock.setBehavior('normal'); mock.reset();
    await assert.rejects(client.getTicket(999999), (e) => e.code === 'NOT_FOUND');
  });

  it('slow response throws TIMEOUT', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl, { timeoutMs: 100 }));
    mock.setBehavior('slow'); mock.reset();
    await assert.rejects(client.listTickets(), (e) => e.code === 'TIMEOUT');
    mock.setBehavior('normal');
  });

  it('client sends only GET requests', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    mock.setBehavior('normal'); mock.reset();
    await client.listTickets({ page: 1, perPage: 2 });
    await client.getTicket(101);
    await client.searchTickets({ query: '"status:2"', page: 1 });
    assert.ok(mock.requests.length >= 3);
    for (const r of mock.requests) assert.equal(r.method, 'GET');
  });

  it('503 is retried with backoff then succeeds', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    mock.setBehavior('error-once-503'); mock.reset();
    const out = await client.listTickets({ page: 1, perPage: 2 });
    assert.ok(Array.isArray(out.items));
    assert.equal(mock.requests.length, 2);
  });

  it('per_page outside 1-100 throws INVALID_INPUT without a request', async () => {
    const client = new FreshdeskClient(cfg(mock.baseUrl));
    mock.setBehavior('normal'); mock.reset();
    await assert.rejects(client.listTickets({ page: 1, perPage: 101 }), (e) => e.code === 'INVALID_INPUT');
    assert.equal(mock.requests.length, 0);
  });
});
