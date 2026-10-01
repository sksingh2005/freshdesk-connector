# freshdesk-connector

A read-only Freshdesk connector exposed as an MCP server over stdio. An Agent Studio agent gets three tools — `list_tickets`, `get_ticket`, `search_tickets` — to read merchant support tickets. The HTTP client only issues GET requests, authenticates with a Freshdesk API key, retries 429/5xx with backoff, and returns trimmed tickets with no requester PII.

## Prerequisites and setup

- Node.js 18+ (ES modules).
- A Freshdesk trial: your subdomain (`acme` for `https://acme.freshdesk.com`) and an API key (profile picture → Profile Settings → View API Key).

```bash
cd freshdesk-connector
npm install
cp .env.example .env   # Windows: copy .env.example .env
# then set FRESHDESK_DOMAIN and FRESHDESK_API_KEY
```

`.env` is git-ignored. Commit `.env.example` only.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `FRESHDESK_DOMAIN` | yes | — | Subdomain only (`acme`, not `acme.freshdesk.com`) |
| `FRESHDESK_API_KEY` | yes | — | Key from Profile Settings → View API Key |
| `FRESHDESK_BASE_URL` | no | `https://{domain}.freshdesk.com/api/v2` | Override for tests / local mock |
| `REQUEST_TIMEOUT_MS` | no | `10000` | Per-request timeout (abort + `TIMEOUT`) |
| `MAX_RETRIES` | no | `4` | Retries for 429 / 502 / 503 / 504 / network errors |

Missing `FRESHDESK_DOMAIN` / `FRESHDESK_API_KEY` exits with an error naming the variable (never the secret).

## How to run

```bash
npm test          # node --test; uses the local mock server, no real credentials needed
npm start         # MCP server over stdio
npm run seed      # creates 12 fictional tickets in your trial (the only writer)
npm run demo -- --mock   # full demo against the mock, incl. a 429 retry
npm run demo      # same script against your real trial (needs .env)
npm run tools:sync  # regenerate tools.json from src/tools.js
```

## Register with an MCP client

```json
{
  "mcpServers": {
    "freshdesk-connector": {
      "command": "node",
      "args": ["C:/path/to/freshdesk-connector/src/server.js"],
      "env": {
        "FRESHDESK_DOMAIN": "acme",
        "FRESHDESK_API_KEY": "<set in your secret store, never in chat>"
      }
    }
  }
}
```

For Agent Studio, keep the same shape but reference your secret store for `FRESHDESK_API_KEY`. All logs go to stderr so stdout stays clean for MCP framing.

## Inspect interactively

```bash
npx @modelcontextprotocol/inspector node src/server.js
```

Open the printed URL, pick `list_tickets` / `get_ticket` / `search_tickets`, and call them. Needs `.env` with real credentials, or point `FRESHDESK_BASE_URL` at the mock via `npm run demo -- --mock` for an offline walkthrough.

## Error catalog

## Error catalog

Tool handlers never return stack traces. Client error codes (`src/freshdeskClient.js`) map to short MCP messages (`src/tools.js`):

| Code | Trigger | Agent-facing message |
|---|---|---|
| `AUTH_FAILED` | 401 / 403 | Authentication failed. Check FRESHDESK_API_KEY and FRESHDESK_DOMAIN. |
| `NOT_FOUND` | 404 | Ticket not found. |
| `RATE_LIMITED` | 429 retries exhausted | Rate limited. Retry after N seconds. |
| `TIMEOUT` | Abort after `REQUEST_TIMEOUT_MS` | Freshdesk request timed out. Try again shortly. |
| `INVALID_INPUT` | Bad page/per_page, bad ticket_id, bad filter | The specific validation message. |
| `UPSTREAM_ERROR` | Other 4xx, 5xx exhausted, network down | Freshdesk is temporarily unavailable. Try again shortly. |

Zod validation failures return `Invalid input: <path>: <reason>` the same way.

## Flow

```
Agent (Agent Studio) --tool call--> MCP server (src/server.js, stdio)
                                          |
                                    tools.js (validate + map)
                                          |
                              freshdeskClient.js (GET only, auth, retry)
                                          |
                                    Freshdesk API v2
```

## Verified API details

Checked against https://developers.freshdesk.com/api/ (Oct 2026). Followed the docs where they differ from memory:

- Base URL `https://{domain}.freshdesk.com/api/v2` — confirmed.
- Auth is HTTP Basic with the API key as username and any password (`X`) — confirmed. Base64-encode `key:X`.
- `GET /tickets` with `page` (from 1) and `per_page` (default 30, max 100) — confirmed. A `Link` header with `rel="next"` marks more pages; otherwise a full page implies more data. **Difference:** the list endpoint has no server-side `status`/`priority` filter, so `list_tickets` accepts those words but applies them client-side after fetching the page. Server-side filtering belongs in `search_tickets`.
- `GET /tickets/{id}` for one ticket — confirmed. `?include=conversations` embeds the thread; `GET /tickets/{id}/conversations` is the fallback. Both are GET. Verified live: the view response carries the description by default, but a combined `include=conversations,description` is rejected (HTTP 400), so the client sends `include=conversations` only.
- List responses omit descriptions unless requested: the client sends `include=description` on `GET /tickets` so `description_preview` is populated. Verified live on a trial account.
- `GET /search/tickets?query="..."` with the query wrapped in double quotes and clauses like `status:2 AND priority:3` — confirmed. Search pages are 30/page, max 10 pages (300 results). Our `hasMore` uses `page * 30 < total`.
- Status codes 2 open, 3 pending, 4 resolved, 5 closed; priority 1 low, 2 medium, 3 high, 4 urgent — confirmed.
- Rate limiting: HTTP 429 with a `Retry-After` (seconds) header, plus `X-Ratelimit-Total/Remaining` on normal responses — confirmed. Trial default is ~50 calls/minute. We honor `Retry-After` capped at 60s, else exponential backoff from 1s with jitter, up to `MAX_RETRIES` (default 4).
- Whether the plan includes API access: trial accounts include API access; agents need read permission on tickets or the API returns 403, which we surface as `AUTH_FAILED` without retrying.

## Design decisions

- **Why read-only:** there is no POST/PUT/PATCH/DELETE code path in `src/`. The private `#request()` hard-codes `method: 'GET'`, and a test asserts the mock only ever sees GET. A prompt-injected agent cannot write because the capability does not exist.
- **Why API key, not OAuth:** Freshdesk's agent API uses per-account API keys; OAuth per-merchant would be better (see CAPABILITIES.md) but is out of scope for this take-home and would add account-coupling complexity.
- **Why trimmed output:** raw tickets carry requester emails, phones, and HTML bodies the agent does not need. `mappers.js` whitelists fields and masks email/phone patterns in free text, keeping payloads small and PII out of the model context.
- **Why a mock server in tests:** `test/mockFreshdesk.js` is a controllable `node:http` server (normal page, last page, 404, 401, one-shot and permanent 429, one-shot 503, slow response). Tests run offline with `npm test` from a fresh clone and assert timing, retry counts, and header construction deterministically. No axios/jest/nock — built-in `fetch` and `node:test` only.

## Assumptions and limitations

Assumptions:
- Node.js 18+ with network access to `*.freshdesk.com` over HTTPS.
- One Freshdesk account per server instance (single domain + API key).
- The API key belongs to an agent/admin with read permission on tickets (otherwise 403 → `AUTH_FAILED`).
- Trial accounts include API access at ~50 calls/minute; plan limits are shared with all other API consumers on the account.

Limitations (full list in `CAPABILITIES.md`): read-only (no create/reply/update/delete), no contacts/companies/attachments, no free-text search, max 300 search results per query, max 5 conversation entries per ticket, pattern-based (not guaranteed) PII masking, no caching, no webhooks (reads may lag writes by seconds to minutes), shared-key auth instead of per-merchant OAuth.

## Unverified / not finished

- No live Freshdesk trial run: seed (`npm run seed`) and real-account demo need your credentials; only mock + docs verified so far.
- No interactive MCP Inspector session, only stdio boot + handler tests.
- Merchant plan API access assumed per docs (trials include API; 403 surfaces as `AUTH_FAILED`).

## What is missing vs the Python DeskBridge

Deliberately small deltas: this connector adds strict per-brief contract items the Python version lacks (GET-only enforcement test, `tools.json` sync test, `status_code`/`priority_code` fields, `description_preview` 300-char shape, `REQUEST_TIMEOUT_MS`/`MAX_RETRIES` env names) and drops Python-only extras (PII toggle env, `updated_since`/`requester_id` list filters) to stay exactly on the brief. See CAPABILITIES.md for limits and the production path.
