// Local HTTP server that imitates Freshdesk for tests. No test touches the real API.
import http from 'node:http';

const TICKET_1 = {
  id: 101, subject: 'Refund not received', description_text: 'Customer paid via UPI, refund pending. Contact hidden.',
  status: 2, priority: 3, created_at: '2026-10-01T09:30:00Z', updated_at: '2026-10-01T11:00:00Z',
  due_by: '2026-10-03T09:30:00Z', tags: ['refund'], requester_id: 501,
  requester_email: 'should-never-leak@example.com', phone: '+91-9999999999',
  conversations: [{ id: 1, incoming: true, private: false, created_at: '2026-10-01T10:00:00Z', body_text: 'Hello, where is my refund?' }],
};
const TICKET_2 = {
  id: 102, subject: 'Payment link not working', description_text: 'Link expires too fast.',
  status: 3, priority: 2, created_at: '2026-10-02T09:30:00Z', updated_at: '2026-10-02T11:00:00Z',
  due_by: '2026-10-04T09:30:00Z', tags: ['payments'], requester_id: 502,
};
const TICKET_3 = {
  id: 103, subject: 'GST invoice request', description_text: 'Need August invoice.',
  status: 2, priority: 4, created_at: '2026-10-03T09:30:00Z', updated_at: '2026-10-03T11:00:00Z',
  due_by: '2026-10-05T09:30:00Z', tags: ['invoice'], requester_id: 503,
};

/**
 * Start the mock. Returns { baseUrl, close, requests, setBehavior, reset }.
 * Behaviors: normal | auth-fail | rate-once | rate-always | error-once-503 | slow
 * Auth: expects `Basic base64(apiKey:X)`; default apiKey is "testkey".
 */
export function startMock({ apiKey = 'testkey' } = {}) {
  const requests = [];
  let behavior = 'normal';
  const state = { rateOnceFired: false, errorOnceFired: false };
  const expectedAuth = `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? null });

    if (behavior === 'slow') {
      // Respond slower than the client timeout; abort will fire first.
      setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); } catch {} }, 500);
      return;
    }

    if (req.headers.authorization !== expectedAuth || behavior === 'auth-fail') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }

    if (behavior === 'rate-always') {
      res.writeHead(429, { 'Retry-After': '1', 'X-Ratelimit-Remaining': '0' });
      res.end(JSON.stringify({ message: 'Rate limited' }));
      return;
    }
    if (behavior === 'rate-once') {
      if (!state.rateOnceFired) {
        state.rateOnceFired = true;
        res.writeHead(429, { 'Retry-After': '1', 'X-Ratelimit-Remaining': '0' });
        res.end(JSON.stringify({ message: 'Rate limited' }));
        return;
      }
    }
    if (behavior === 'error-once-503') {
      if (!state.errorOnceFired) {
        state.errorOnceFired = true;
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Service unavailable' }));
        return;
      }
    }

    if (url.pathname === '/api/v2/tickets' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? '20');
      // Middle page is full; last page is partial (drives hasMore tests).
      const all = [TICKET_1, TICKET_2, TICKET_3];
      const start = (page - 1) * perPage;
      const slice = all.slice(start, start + perPage);
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Ratelimit-Remaining': '699' });
      res.end(JSON.stringify(slice));
      return;
    }

    const single = url.pathname.match(/^\/api\/v2\/tickets\/(\d+)(\/conversations)?$/);
    if (single && req.method === 'GET') {
      const id = Number(single[1]);
      if (single[2] === '/conversations') {
        const t = [TICKET_1, TICKET_2, TICKET_3].find((x) => x.id === id);
        if (!t) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(t.conversations ?? []));
        return;
      }
      const t = [TICKET_1, TICKET_2, TICKET_3].find((x) => x.id === id);
      if (!t) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(url.searchParams.get('include') === 'conversations' ? t : { ...t, conversations: undefined }));
      return;
    }

    if (url.pathname === '/api/v2/search/tickets' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? '1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: page === 1 ? [TICKET_1, TICKET_2] : [], total: 2 }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/api/v2`,
        requests,
        setBehavior: (b) => { behavior = b; state.rateOnceFired = false; state.errorOnceFired = false; },
        reset: () => { requests.length = 0; state.rateOnceFired = false; state.errorOnceFired = false; },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
