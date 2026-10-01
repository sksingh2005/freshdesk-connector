# freshdesk-connector MCP Tool Specification

Server: **`freshdesk-connector`** · Transport: **stdio** · All tools **read-only**.
Source of truth: `src/tools.js` (`TOOL_SPECS` + zod schemas). `tools.json` is regenerated via `npm run tools:sync`; this file is hand-kept and covered by the spec-sync test.

## Shared types

### Ticket object
| Field | Type | Notes |
|---|---|---|
| `id` | integer | Freshdesk ticket ID |
| `subject` | string \| null | Max 200 chars |
| `status` | string | `open` \| `pending` \| `resolved` \| `closed` \| `other` |
| `status_code` | integer \| null | Raw Freshdesk code (2/3/4/5) |
| `priority` | string | `low` \| `medium` \| `high` \| `urgent` \| `other` |
| `priority_code` | integer \| null | Raw Freshdesk code (1/2/3/4) |
| `created_at` / `updated_at` / `due_by` | string \| null | ISO 8601 UTC |
| `tags` | string[] | As stored in Freshdesk |
| `description_preview` | string \| null | Plain-text, PII-masked, max 300 chars |

No requester emails, phones, or other personal structured fields are ever returned.

### Conversation object (inside `get_ticket`)
| Field | Type | Notes |
|---|---|---|
| `id` | integer | Entry ID |
| `incoming` | boolean \| null | True = customer message |
| `private` | boolean \| null | True = internal note |
| `created_at` | string \| null | ISO 8601 UTC |
| `body` | string \| null | Plain-text, PII-masked, max 500 chars |

## Tool: `list_tickets`

List tickets, most recent first. `status`/`priority` are applied client-side after fetching the page; use `search_tickets` for server-side filtering.

Input schema (`tools.json#/tools/list_tickets/inputSchema`):
```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["open", "pending", "resolved", "closed"] },
    "priority": { "type": "string", "enum": ["low", "medium", "high", "urgent"] },
    "page": { "type": "integer", "minimum": 1, "default": 1 },
    "per_page": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
  }
}
```

Output: `{ "items": Ticket[], "page": 1, "has_more": true }`.

Example call: `{ "status": "open", "priority": "urgent", "page": 1, "per_page": 20 }`.

Limitations: no server-side status/priority filter on `GET /tickets`; one page of raw results is filtered in memory.

## Tool: `get_ticket`

One ticket by ID with its last 5 conversation entries.

Input schema:
```json
{
  "type": "object",
  "required": ["ticket_id"],
  "properties": { "ticket_id": { "type": "integer", "minimum": 1 } }
}
```

Output: one `Ticket` plus `conversations: Conversation[]` (max 5).

Example call: `{ "ticket_id": 123 }`.

Limitations: attachments not included; conversation fetch is best-effort (ticket still returned if it fails with a retryable error).

## Tool: `search_tickets`

Field filters AND-combined into a Freshdesk `query="..."` string built server-side. Raw queries are never accepted.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["open", "pending", "resolved", "closed"] },
    "priority": { "type": "string", "enum": ["low", "medium", "high", "urgent"] },
    "tag": { "type": "string", "maxLength": 50 },
    "created_after": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "page": { "type": "integer", "minimum": 1, "maximum": 10, "default": 1 }
  }
}
```

At least one filter is required. Output: `{ "items": Ticket[], "page": 1, "has_more": false }`.

Example call: `{ "status": "open", "tag": "refund", "page": 1 }` → query `"status:2 AND tag:'refund'"`.

Limitations: 30 results/page × 10 pages = 300 max; tag match is exact; no free-text search.

## Error behaviour

Same catalog as `README.md#Error catalog`: `AUTH_FAILED`, `NOT_FOUND`, `RATE_LIMITED` (with wait seconds), `TIMEOUT`, `INVALID_INPUT`, `UPSTREAM_ERROR`, plus `Invalid input: <path>: <reason>` for schema violations. No stack traces leave the server.

## Regenerating the spec

```bash
npm run tools:sync   # rewrites tools.json from src/tools.js
npm test             # fails if tools.json drifted from TOOL_SPECS
```
