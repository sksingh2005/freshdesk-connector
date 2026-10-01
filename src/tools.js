// Single source of truth for MCP tool definitions (name, description, zod schema, handler).
// server.js registers these; tools.json mirrors them (see scripts/sync-tools.js and test assertion).
import { z } from 'zod';
import { loadConfig } from './config.js';
import { FreshdeskClient, FreshdeskError } from './freshdeskClient.js';
import { mapConversation, mapTicket } from './mappers.js';

export const STATUS_WORD_TO_CODE = { open: 2, pending: 3, resolved: 4, closed: 5 };
export const PRIORITY_WORD_TO_CODE = { low: 1, medium: 2, high: 3, urgent: 4 };

const TAG_RE = /^[A-Za-z0-9_\- ]{1,50}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the Freshdesk search `query="..."` string from validated fields.
 * The agent never passes raw query text, so it cannot inject operators.
 */
export function buildSearchQuery({ status, priority, tag, created_after } = {}) {
  const parts = [];
  if (status !== undefined && status !== null) {
    const code = STATUS_WORD_TO_CODE[status];
    if (!code) throw new FreshdeskError('INVALID_INPUT', `status must be one of: open, pending, resolved, closed. Got "${status}".`);
    parts.push(`status:${code}`);
  }
  if (priority !== undefined && priority !== null) {
    const code = PRIORITY_WORD_TO_CODE[priority];
    if (!code) throw new FreshdeskError('INVALID_INPUT', `priority must be one of: low, medium, high, urgent. Got "${priority}".`);
    parts.push(`priority:${code}`);
  }
  if (tag !== undefined && tag !== null && tag !== '') {
    const t = String(tag).trim();
    if (!TAG_RE.test(t)) {
      throw new FreshdeskError('INVALID_INPUT', 'tag may only contain letters, digits, spaces, hyphens and underscores (1-50 chars).');
    }
    parts.push(`tag:'${t}'`);
  }
  if (created_after !== undefined && created_after !== null && created_after !== '') {
    const d = String(created_after).trim();
    if (!DATE_RE.test(d)) {
      throw new FreshdeskError('INVALID_INPUT', `created_after must be YYYY-MM-DD. Got "${created_after}".`);
    }
    parts.push(`created_at>'${d}'`);
  }
  if (parts.length === 0) {
    throw new FreshdeskError('INVALID_INPUT', 'Provide at least one filter: status, priority, tag, or created_after.');
  }
  return `"${parts.join(' AND ')}"`;
}

// ---- Zod input schemas (used by the MCP server) ----

export const listTicketsSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional().describe('Filter by status word (applied client-side).'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Filter by priority word (applied client-side).'),
  page: z.number().int().min(1).default(1).describe('Page number (1-based).'),
  per_page: z.number().int().min(1).max(100).default(20).describe('Results per page (1-100).'),
});

export const getTicketSchema = z.object({
  ticket_id: z.number().int().positive().describe('Freshdesk ticket ID.'),
});

export const searchTicketsSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  tag: z.string().max(50).optional().describe('Exact tag match.'),
  created_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  page: z.number().int().min(1).max(10).default(1).describe('Page 1-10 (max 300 results).'),
});

// ---- JSON Schema mirrors (kept in tools.json; test fails on drift) ----

export const TOOL_SPECS = [
  {
    name: 'list_tickets',
    description: 'List Freshdesk tickets, most recent first. Optional status/priority filters are applied client-side; use search_tickets for server-side filtering. Read-only.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'pending', 'resolved', 'closed'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        page: { type: 'integer', minimum: 1, default: 1 },
        per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    exampleCall: { status: 'open', priority: 'urgent', page: 1, per_page: 20 },
    exampleResponse: {
      items: [{ id: 123, subject: 'Refund not received', status: 'open', status_code: 2, priority: 'high', priority_code: 3, created_at: '2026-10-01T09:30:00Z', updated_at: '2026-10-01T11:00:00Z', due_by: '2026-10-03T09:30:00Z', tags: ['refund'], description_preview: 'First 300 characters…' }],
      page: 1,
      has_more: true,
    },
  },
  {
    name: 'get_ticket',
    description: 'Fetch one Freshdesk ticket by ID with its last 5 conversation entries (each truncated to 500 chars). Read-only.',
    inputJsonSchema: {
      type: 'object',
      required: ['ticket_id'],
      properties: {
        ticket_id: { type: 'integer', minimum: 1 },
      },
    },
    exampleCall: { ticket_id: 123 },
    exampleResponse: {
      id: 123, subject: 'Refund not received', status: 'open', status_code: 2, priority: 'high', priority_code: 3,
      created_at: '2026-10-01T09:30:00Z', updated_at: '2026-10-01T11:00:00Z', due_by: '2026-10-03T09:30:00Z',
      tags: ['refund'], description_preview: 'First 300 characters…',
      conversations: [{ id: 9, incoming: true, private: false, created_at: '2026-10-01T10:00:00Z', body: 'Customer reply…' }],
    },
  },
  {
    name: 'search_tickets',
    description: 'Search Freshdesk tickets by status, priority, tag, and/or created_after date (AND-combined). The query string is built server-side; raw queries are not accepted. Max 10 pages (300 results). Read-only.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'pending', 'resolved', 'closed'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        tag: { type: 'string', maxLength: 50 },
        created_after: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        page: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
      },
    },
    exampleCall: { status: 'open', tag: 'refund', page: 1 },
    exampleResponse: {
      items: [{ id: 123, subject: 'Refund not received', status: 'open', status_code: 2, priority: 'high', priority_code: 3, created_at: '2026-10-01T09:30:00Z', updated_at: '2026-10-01T11:00:00Z', due_by: '2026-10-03T09:30:00Z', tags: ['refund'], description_preview: 'First 300 characters…' }],
      page: 1,
      has_more: false,
    },
  },
];

// ---- Client injection (tests set a mock; server uses the real one) ----

let _client = null;
let _config = null;

export function setToolsClient(client) {
  _client = client;
}

export function getToolsClient() {
  if (!_client) {
    _config = loadConfig();
    _client = new FreshdeskClient(_config);
  }
  return _client;
}

function friendlyError(err) {
  if (err instanceof FreshdeskError) {
    switch (err.code) {
      case 'RATE_LIMITED': {
        const wait = err.retryAfterSec ?? 60;
        return `Rate limited. Retry after ${wait} seconds.`;
      }
      case 'AUTH_FAILED':
        return 'Authentication failed. Check FRESHDESK_API_KEY and FRESHDESK_DOMAIN.';
      case 'NOT_FOUND':
        return 'Ticket not found.';
      case 'TIMEOUT':
        return 'Freshdesk request timed out. Try again shortly.';
      case 'INVALID_INPUT':
        return err.message;
      default:
        return 'Freshdesk is temporarily unavailable. Try again shortly.';
    }
  }
  return 'Unexpected error. Try again shortly.';
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const mcpError = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

async function listTicketsHandler(args) {
  try {
    const input = listTicketsSchema.parse(args);
    const client = getToolsClient();
    const { items, page, hasMore } = await client.listTickets({ page: input.page, perPage: input.per_page });
    let mapped = items.map(mapTicket);
    if (input.status) mapped = mapped.filter((t) => t.status === input.status);
    if (input.priority) mapped = mapped.filter((t) => t.priority === input.priority);
    return ok({ items: mapped, page, has_more: hasMore });
  } catch (err) {
    if (err?.name === 'ZodError') return mcpError(`Invalid input: ${err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
    return mcpError(friendlyError(err));
  }
}

async function getTicketHandler(args) {
  try {
    const input = getTicketSchema.parse(args);
    const client = getToolsClient();
    const raw = await client.getTicket(input.ticket_id, { includeConversations: true });
    const ticket = mapTicket(raw);
    const convs = Array.isArray(raw?.conversations) ? raw.conversations : [];
    ticket.conversations = convs.slice(-5).map((c) => {
      const { body, ...rest } = mapConversation(c);
      return { ...rest, body };
    });
    return ok(ticket);
  } catch (err) {
    if (err?.name === 'ZodError') return mcpError(`Invalid input: ${err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
    return mcpError(friendlyError(err));
  }
}

async function searchTicketsHandler(args) {
  try {
    const input = searchTicketsSchema.parse(args);
    const query = buildSearchQuery(input);
    const client = getToolsClient();
    const { items, page, hasMore } = await client.searchTickets({ query, page: input.page });
    return ok({ items: items.map(mapTicket), page, has_more: hasMore, query });
  } catch (err) {
    if (err?.name === 'ZodError') return mcpError(`Invalid input: ${err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
    return mcpError(friendlyError(err));
  }
}

// Tool definitions: each defined once here, registered in server.js.
export const TOOLS = [
  { name: 'list_tickets', description: TOOL_SPECS[0].description, schema: listTicketsSchema, handler: listTicketsHandler },
  { name: 'get_ticket', description: TOOL_SPECS[1].description, schema: getTicketSchema, handler: getTicketHandler },
  { name: 'search_tickets', description: TOOL_SPECS[2].description, schema: searchTicketsSchema, handler: searchTicketsHandler },
];
