// Launch the MCP server against fictional local tickets for Inspector demos.
// Set the mock credentials before importing server.js, which loads config.
import { startMock } from '../test/mockFreshdesk.js';

const mock = await startMock({ apiKey: 'testkey' });
process.env.FRESHDESK_DOMAIN = 'demo';
process.env.FRESHDESK_API_KEY = 'testkey';
process.env.FRESHDESK_BASE_URL = mock.baseUrl;

await import('../src/server.js');
