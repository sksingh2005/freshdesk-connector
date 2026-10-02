# MCP tool specification

The `freshdesk-connector` server exposes three read-only tools over stdio. `src/tools.js` defines their Zod input schemas and JSON specifications. Run `npm run tools:sync` to regenerate `tools.json`; a test checks that the files agree. This document describes their behavior.

## Shared types

### Ticket object

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Freshdesk ticket ID |
| `subject` | string \| null | Truncated after 200 characters, with a marker added |
| `status` | string | `open` \| `pending` \| `resolved` \| `closed` \| `other` |
| `status_code` | integer \| null | Raw Freshdesk code (2/3/4/5) |
| `priority` | string | `low` \| `medium` \| `high` \| `urgent` \| `other` |
| `priority_code` | integer \| null | Raw Freshdesk code (1/2/3/4) |
| `created_at` / `updated_at` / `due_by` | string \| null | ISO 8601 UTC |
| `tags` | string[] | As stored in Freshdesk |
| `description_preview` | string \| null | Plain text; common email and phone patterns masked; truncated after 300 characters, with a marker added |

The mapper omits requester contact fields. It returns subject and tags without masking, so the output may still contain personal data.

### Conversation object (inside `get_ticket`)

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Entry ID |
| `incoming` | boolean \| null | True = customer message |
| `private` | boolean \| null | True = internal note |
| `created_at` | string \| null | ISO 8601 UTC |
| `body` | string \| null | Plain text; common email and phone patterns masked; truncated after 500 characters, with a marker added |

## Tool: `list_tickets`

List one page of tickets. The connector applies `status` and `priority` after fetching the page. Use `search_tickets` when those filters need to run on Freshdesk.

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

A filtered page may be short or empty even when `has_more` is true, because later Freshdesk pages may contain matches.

## Tool: `get_ticket`

Get one ticket by ID and up to five recent conversation entries.

Input schema:

```json
{
  "type": "object",
  "required": ["ticket_id"],
  "properties": { "ticket_id": { "type": "integer", "minimum": 1 } }
}
```

Output: one `Ticket` plus `conversations: Conversation[]` (up to five entries).

Example call: `{ "ticket_id": 123 }`.

The tool does not return attachments. If a retryable error prevents the separate conversation request, the tool can still return the ticket without conversations.

## Tool: `search_tickets`

The connector combines field filters with `AND` in a Freshdesk `query="..."` string. The agent cannot supply a raw query.

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

Example call: `{ "status": "open", "tag": "refund", "page": 1 }`. The connector builds `"status:2 AND tag:'refund'"`.

Search returns at most 30 results per page and 10 pages. Tag matching is exact. The tool does not support keyword search.

## Errors

The tools return short messages for `AUTH_FAILED`, `NOT_FOUND`, `RATE_LIMITED` (with a retry delay), `TIMEOUT`, `INVALID_INPUT`, and `UPSTREAM_ERROR`. Schema failures return `Invalid input: <path>: <reason>`. The server does not return stack traces. See the [README error table](../README.md#errors).

## Regenerating the spec

```bash
npm run tools:sync
npm test
```

The test fails if `tools.json` differs from `TOOL_SPECS`.
