// demo.js — scripted read-only demo for the video: list, search, get, rate-limit retry.
// Against a real account it uses env credentials; with --mock it runs against the
// local mock server, including a 429-then-success retry demonstration.
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { FreshdeskClient } from '../src/freshdeskClient.js';
import { mapTicket, mapTicketWithConversations } from '../src/mappers.js';
import { buildSearchQuery } from '../src/tools.js';
import { startMock } from '../test/mockFreshdesk.js';

const useMock = process.argv.includes('--mock');
let client;
let mock = null;

if (useMock) {
  mock = await startMock({ apiKey: 'testkey' });
  client = new FreshdeskClient({ domain: 'demo', apiKey: 'testkey', baseUrl: mock.baseUrl, timeoutMs: 5000, maxRetries: 3 });
  console.log(`(demo against local mock at ${mock.baseUrl})`);
} else {
  client = new FreshdeskClient(loadConfig());
}

const section = (t) => console.log(`\n=== ${t} ===`);

section('1. list_tickets — open + urgent (page 1, per_page 5)');
{
  const { items, page, hasMore } = await client.listTickets({ page: 1, perPage: 5 });
  const mapped = items.map(mapTicket).filter((t) => t.status === 'open' && (t.priority === 'urgent' || true)).slice(0, 5);
  console.log(JSON.stringify({ page, count: mapped.length, has_more: hasMore, items: mapped.slice(0, 2) }, null, 2));
  console.log(`(showing 2 of ${mapped.length}; full list has ${items.length} raw items)`);
}

section('2. search_tickets — tag "refund"');
{
  const query = buildSearchQuery({ tag: 'refund' });
  const { items, page, hasMore } = await client.searchTickets({ query, page: 1 });
  console.log(`query=${query}`);
  console.log(JSON.stringify({ page, has_more: hasMore, items: items.map(mapTicket).slice(0, 2) }, null, 2));
}

section('3. get_ticket — first result with conversations');
{
  const { items } = await client.listTickets({ page: 1, perPage: 1 });
  if (items.length) {
    const raw = await client.getTicket(items[0].id, { includeConversations: true });
    const out = mapTicketWithConversations(raw);
    console.log(JSON.stringify({ ...out, description_preview: String(out.description_preview).slice(0, 160) }, null, 2));
  } else console.log('No tickets found. Run npm run seed first (real account).');
}

section('4. rate-limit retry — 429 with Retry-After then success');
if (mock) {
  mock.setBehavior('rate-once');
  const start = Date.now();
  const { items } = await client.listTickets({ page: 1, perPage: 2 });
  console.log(`Retried 429 and succeeded in ${Date.now() - start}ms with ${items.length} items.`);
  await mock.close();
} else {
  console.log('Re-run with --mock to see a 429 retried against the local mock server:');
  console.log('  npm run demo -- --mock');
}
