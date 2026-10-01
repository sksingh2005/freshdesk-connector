# CAPABILITIES — freshdesk-connector

Short document for the people who will give this connector to an agent.

## What the agent can do

List, fetch, and search tickets in one Freshdesk account, filtered by status, priority, tag, and date:

- `list_tickets`: paged recent tickets (`page`, `per_page` 1–100, default 20). Optional `status`/`priority` words filter the returned page client-side.
- `get_ticket`: one ticket by `ticket_id` plus its last 5 conversation entries (each truncated to 500 chars).
- `search_tickets`: server-side filter by `status`, `priority`, exact `tag`, `created_after` (YYYY-MM-DD), and `page` (1–10). Clauses are AND-combined into a Freshdesk `query="..."` string built by the connector — the agent never sends raw query text.

All output is trimmed (`id, subject, status(+code), priority(+code), created_at, updated_at, due_by, tags, description_preview`) with requester PII dropped and email/phone patterns masked in free text.

## What the agent cannot do

- Create, update, reply to, assign, forward, merge, or delete tickets — no write code exists.
- See contact or company records, knowledge-base articles, time entries, or satisfaction ratings.
- Read attachments — not fetched or returned.
- Access other Freshdesk accounts — one domain + key per server instance.
- See requester personal details — emails, phones, names in structured fields are whitelisted out; free-text matches are masked, not guaranteed removed.
- Run free-text/keyword search — only field-equality and date-range filters are exposed.
- Return more than 300 search results per query (30/page × 10 pages) or more than 5 conversations per ticket in this connector.

## Known limitations

- **API-key auth instead of OAuth:** one shared key for all agent calls. Rotation breaks every consumer at once; the rate limit is shared with any other API user on the account.
- **No caching:** every tool call hits Freshdesk, spending rate-limit budget on repeated reads.
- **No webhooks:** data may be seconds to minutes stale; there is no push on ticket updates.
- **Freshdesk search page limits:** max 10 pages; broad queries must be narrowed.
- **Shared rate limit:** 429s are retried (Retry-After capped at 60s, `MAX_RETRIES` default 4), but sustained overload fails cleanly with `RATE_LIMITED` rather than queueing.
- **Masking is pattern-based:** catches common emails/phones, misses names, addresses, IDs, and unusual formats.

## Long-term fixes (each tied to a limitation)

- OAuth with per-merchant tokens in a secrets manager (fixes shared-key blast radius and enables per-merchant audit).
- Short-TTL response cache (e.g. Redis) keyed by ticket ID/query hash, invalidated by Freshdesk webhooks (fixes repeat-read cost and staleness).
- Webhook-driven sync into a local index for search (fixes 300-result ceiling and enables full-text search).
- Per-agent audit log of tool, params, merchant, timestamp, stored apart from app logs (fixes accountability).
- Merchant-configured field-level rules, e.g. unmasking requester email only for explicitly allowed queues (fixes all-or-nothing PII handling).

## Security notes

- Key lives in `FRESHDESK_API_KEY` (env/secret store only). `.env` is git-ignored; only `.env.example` is committed. Rotate immediately if the key appears in logs or git history (Freshdesk Profile Settings → revoke/reissue).
- Logged per request: method, path, status, duration (stderr). Never logged: headers, query secrets, the API key, request/response bodies.
- Seed data is fictional (`[FICTIONAL]` prefix, `fake.userNN@example.com`). No real customer data anywhere in the repo.
