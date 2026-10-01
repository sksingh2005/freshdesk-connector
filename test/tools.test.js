import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FreshdeskClient } from '../src/freshdeskClient.js';
import { mapTicket } from '../src/mappers.js';
import { TOOL_SPECS, TOOLS, buildSearchQuery, setToolsClient } from '../src/tools.js';
import { startMock } from './mockFreshdesk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = (baseUrl, overrides = {}) => ({ domain: 't', apiKey: 'testkey', baseUrl, timeoutMs: 5000, maxRetries: 2, ...overrides });

describe('tools', () => {
  let mock;
  before(async () => {
    mock = await startMock({ apiKey: 'testkey' });
    mock.setBehavior('normal');
    setToolsClient(new FreshdeskClient(cfg(mock.baseUrl)));
  });
  after(async () => { await mock.close(); });

  it('search_tickets rejects query-injection inputs', async () => {
    const search = TOOLS.find((t) => t.name === 'search_tickets');
    for (const bad of ['open" OR "1"="1', 'refund" AND status:5', 'a"; DROP TABLE']) {
      const res = await search.handler({ tag: bad });
      assert.equal(res.isError, true, `expected rejection for ${bad}`);
      assert.match(res.content[0].text, /tag|Invalid/i);
    }
    const badDate = await search.handler({ created_after: '2026-10-01" AND status:5' });
    assert.equal(badDate.isError, true);
    const noFilter = await search.handler({});
    assert.equal(noFilter.isError, true);
  });

  it('mapped output contains no requester email or phone fields', async () => {
    const raw = {
      id: 1, subject: 'x', status: 2, priority: 3, created_at: 't', updated_at: 't', due_by: null, tags: [],
      description_text: 'hello', requester_email: 'a@b.com', phone: '123', email: 'a@b.com', mobile: '1', custom_fields: {},
    };
    const out = mapTicket(raw);
    const flat = JSON.stringify(out);
    assert.ok(!('requester_email' in out) && !('phone' in out) && !('email' in out));
    assert.ok(!flat.includes('a@b.com'));
  });

  it('list/get/search handlers return trimmed tickets with page flags', async () => {
    const list = TOOLS.find((t) => t.name === 'list_tickets').handler;
    const got = JSON.parse((await list({ page: 1, per_page: 2 })).content[0].text);
    assert.equal(got.page, 1);
    assert.equal(typeof got.has_more, 'boolean');
    assert.ok(!('requester_email' in got.items[0]));

    const get = TOOLS.find((t) => t.name === 'get_ticket').handler;
    const one = JSON.parse((await get({ ticket_id: 101 })).content[0].text);
    assert.equal(one.id, 101);

    const search = TOOLS.find((t) => t.name === 'search_tickets').handler;
    const res = await search({ status: 'open' });
    assert.equal(res.isError, undefined);
  });

  it('tool errors are short MCP errors without stack traces', async () => {
    const get = TOOLS.find((t) => t.name === 'get_ticket').handler;
    const res = await get({ ticket_id: 999999 });
    assert.equal(res.isError, true);
    assert.ok(!res.content[0].text.includes(' at ') && !res.content[0].text.includes('node:'));
  });

  it('tools.json matches the tool definitions', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools.json'), 'utf8'));
    assert.equal(doc.tools.length, TOOL_SPECS.length);
    for (const spec of TOOL_SPECS) {
      const fromFile = doc.tools.find((t) => t.name === spec.name);
      assert.ok(fromFile, `missing ${spec.name} in tools.json`);
      assert.equal(fromFile.description, spec.description);
      assert.deepEqual(fromFile.inputSchema, spec.inputJsonSchema);
      assert.ok(fromFile.exampleCall && fromFile.exampleResponse, `${spec.name} needs examples`);
    }
    const toolNames = TOOLS.map((t) => t.name).sort();
    assert.deepEqual(toolNames, TOOL_SPECS.map((s) => s.name).sort());
  });

  it('query builder AND-combines validated fields and wraps in quotes', () => {
    const q = buildSearchQuery({ status: 'open', priority: 'high', tag: 'refund', created_after: '2026-01-01' });
    assert.equal(q, '"status:2 AND priority:3 AND tag:\'refund\' AND created_at>\'2026-01-01\'"');
  });

  it('docs/TOOL_SPEC.md covers every tool in the spec', () => {
    const specDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'TOOL_SPEC.md'), 'utf8');
    for (const spec of TOOL_SPECS) {
      assert.ok(specDoc.includes(`\`${spec.name}\``), `TOOL_SPEC.md missing ${spec.name}`);
    }
  });

  it('tools.json examples validate against the live zod schemas', () => {    for (const spec of TOOL_SPECS) {
      const tool = TOOLS.find((t) => t.name === spec.name);
      const parsed = tool.schema.safeParse(spec.exampleCall);
      assert.equal(parsed.success, true, `${spec.name} exampleCall fails zod schema: ${JSON.stringify(parsed.error?.issues)}`);
    }
    // Spot-check that invalid values fail the live schemas too.
    const search = TOOLS.find((t) => t.name === 'search_tickets').schema;
    assert.equal(search.safeParse({ status: 'bogus', page: 1 }).success, false);
    assert.equal(search.safeParse({ page: 11 }).success, false);
  });
});
