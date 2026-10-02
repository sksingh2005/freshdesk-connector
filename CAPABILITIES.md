# Agent capabilities

The MCP server connects to one Freshdesk account with one API key. Its three tools read tickets:

- `list_tickets` returns one page of tickets. Freshdesk limits the default list to tickets created within the last 30 days and at most 300 pages. This tool does not expose `updated_since`. `status` and `priority` filter that fetched page locally, so a short or empty result does not mean there are no matches on later pages.
- `get_ticket` returns one ticket by ID and up to the last five conversation entries returned by Freshdesk. The connector does not sort them by time. Each conversation body is truncated after 500 characters, with a truncation marker added.
- `search_tickets` combines the supplied status, priority, exact tag, and creation-date filters. At least one filter is required. Freshdesk search allows at most 10 pages of 30 results.

The output includes ticket ID, subject, status and priority with their numeric codes, dates, tags, and a description preview. Structured requester contact fields are omitted. Common email and phone patterns are masked in descriptions and conversation bodies.

## What the agent cannot do

- Create, update, assign, reply to, forward, merge, or delete tickets.
- Read attachments, contact or company records, knowledge-base articles, time entries, or satisfaction ratings.
- Access another Freshdesk account through the same server instance.
- Run keyword search or pass a raw Freshdesk search query.
- Retrieve more than 300 search results for one query or more than five conversation entries for one ticket.

Do not treat the output as free of personal data. Subject and tags are returned without masking. Pattern matching in descriptions and conversations can miss names, addresses, IDs, or unusual email and phone formats.

## Operational limits

The key is shared by all calls to this server. Other API consumers on the same Freshdesk account also use its rate-limit allowance. The client retries 429 responses using `Retry-After` when present, with each wait capped at 60 seconds. It stops after `MAX_RETRIES` additional attempts and returns `RATE_LIMITED` if the limit persists.

Successful tool calls read Freshdesk directly. There is no cache or webhook listener. Freshdesk search stops at page 10, and search updates may take a few minutes to appear in its index. The connector does not maintain a local search index. For `list_tickets`, `has_more` is based on whether the fetched page is full, so a full final page can report `true`. Conversation fetching is best effort: a retryable failure can leave a successful ticket response without conversations.

This repository includes a generic MCP server, but no Agent Studio-specific adapter or recorded end-to-end Agent Studio test.

## Security and future work

Keep `FRESHDESK_API_KEY` in the process environment or a secret store. Do not commit `.env`. The `FRESHDESK_BASE_URL` override is for local tests; pointing it to an untrusted host would send the key there. Rotate the key if it appears in logs or Git history.

Request logs on stderr contain the method, path, status, and duration. They do not include the key, authorization header, query values, or response bodies. The optional seed script creates fictional tickets and is separate from the read-only server.

For deployment across merchants, add per-merchant credentials and access rules, a short-lived response cache, and an audit log tied to each agent call. Webhooks or a local index could reduce repeated reads and support search beyond Freshdesk's 300-result window.
