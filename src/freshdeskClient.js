// GET-only Freshdesk HTTP client with timeout, retries, and typed errors.
import { loadConfig } from './config.js';

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_SINGLE_WAIT_MS = 60_000;

/** Typed connector error with a stable `code` field. */
export class FreshdeskError extends Error {
  /**
   * @param {string} code one of AUTH_FAILED, NOT_FOUND, RATE_LIMITED, UPSTREAM_ERROR, TIMEOUT, INVALID_INPUT
   * @param {string} message human-readable detail (no secrets)
   * @param {{status?: number, retryAfterSec?: number}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'FreshdeskError';
    this.code = code;
    this.status = extra.status ?? 0;
    if (extra.retryAfterSec !== undefined) this.retryAfterSec = extra.retryAfterSec;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff starting at 1s with small jitter. */
export function backoffMs(attempt) {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return base + Math.random() * 500;
}

/** Parse Retry-After (seconds); fall back to backoff. Capped at 60s. */
export function retryAfterMs(value, attempt) {
  const secs = Number(value);
  if (value != null && Number.isFinite(secs) && secs >= 0) {
    return Math.min(MAX_SINGLE_WAIT_MS, secs * 1000);
  }
  return Math.min(MAX_SINGLE_WAIT_MS, backoffMs(attempt));
}

function buildAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;
}

function logTiming(method, path, status, startedAt) {
  // Method, path, status, duration only. Never headers or the API key.
  const ms = Date.now() - startedAt;
  console.error(`[freshdesk] ${method} ${path} -> ${status} (${ms}ms)`);
}

export class FreshdeskClient {
  #config;
  #authHeader;

  constructor(config = loadConfig()) {
    this.#config = config;
    // Build the Basic-auth header once from the API key.
    this.#authHeader = buildAuthHeader(config.apiKey);
  }

  /** Exposed for tests: assert the header without leaking the key into logs. */
  getAuthHeader() {
    return this.#authHeader;
  }

  get baseUrl() {
    return this.#config.baseUrl;
  }

  /**
   * Private GET-only request. This client has no POST/PUT/PATCH/DELETE path.
   * @param {string} path e.g. "/tickets"
   * @param {Record<string, unknown>} [params]
   */
  async #request(path, params = {}) {
    const { baseUrl, timeoutMs, maxRetries } = this.#config;
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    let lastWaitMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Hard-coded GET: there is no way to send a write through this client.
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: this.#authHeader },
          signal: controller.signal,
        });
        clearTimeout(timer);
        logTiming('GET', path, res.status, startedAt);

        if (res.status === 429) {
          const waitMs = Math.min(MAX_SINGLE_WAIT_MS, retryAfterMs(res.headers.get('Retry-After'), attempt));
          lastWaitMs = waitMs;
          if (attempt === maxRetries) {
            throw new FreshdeskError('RATE_LIMITED', `Rate limited. Retry after ${Math.ceil(waitMs / 1000)} seconds.`, {
              status: 429,
              retryAfterSec: Math.ceil(waitMs / 1000),
            });
          }
          await sleep(waitMs);
          continue;
        }

        if (RETRYABLE_STATUS.has(res.status)) {
          const waitMs = Math.min(MAX_SINGLE_WAIT_MS, backoffMs(attempt));
          lastWaitMs = waitMs;
          if (attempt === maxRetries) {
            throw new FreshdeskError('UPSTREAM_ERROR', `Freshdesk is temporarily unavailable (HTTP ${res.status}). Try again shortly.`, { status: res.status });
          }
          await sleep(waitMs);
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          throw new FreshdeskError('AUTH_FAILED', 'Authentication failed. Check FRESHDESK_API_KEY and FRESHDESK_DOMAIN.', { status: res.status });
        }
        if (res.status === 404) {
          throw new FreshdeskError('NOT_FOUND', 'Ticket not found.', { status: 404 });
        }
        if (res.status >= 400) {
          throw new FreshdeskError('UPSTREAM_ERROR', `Freshdesk request failed (HTTP ${res.status}).`, { status: res.status });
        }

        const text = await res.text();
        return text ? JSON.parse(text) : null;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof FreshdeskError) throw err;
        const isAbort = err?.name === 'AbortError';
        logTiming('GET', path, isAbort ? 'TIMEOUT' : 'NETWORK_ERROR', startedAt);
        if (isAbort) {
          throw new FreshdeskError('TIMEOUT', `Request timed out after ${timeoutMs}ms.`, { retryAfterSec: undefined });
        }
        // Network failure: retry with backoff.
        const waitMs = Math.min(MAX_SINGLE_WAIT_MS, backoffMs(attempt));
        lastWaitMs = waitMs;
        if (attempt === maxRetries) {
          throw new FreshdeskError('UPSTREAM_ERROR', `Network error reaching Freshdesk: ${err?.message ?? err}`, {});
        }
        await sleep(waitMs);
      }
    }
    throw new FreshdeskError('RATE_LIMITED', `Rate limited. Retry after ${Math.ceil(lastWaitMs / 1000)} seconds.`, {
      status: 429,
      retryAfterSec: Math.ceil(lastWaitMs / 1000),
    });
  }

  static validatePagination(page, perPage) {
    if (!Number.isInteger(page) || page < 1) {
      throw new FreshdeskError('INVALID_INPUT', 'page must be an integer >= 1.');
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new FreshdeskError('INVALID_INPUT', 'per_page must be an integer between 1 and 100.');
    }
  }

  /** List tickets. Returns { items, page, hasMore }. */
  async listTickets({ page = 1, perPage = 20, ...rest } = {}) {
    FreshdeskClient.validatePagination(page, perPage);
    const data = await this.#request('/tickets', { page, per_page: perPage, ...rest });
    const items = Array.isArray(data) ? data : [];
    return { items, page, hasMore: items.length === perPage };
  }

  /** Get one ticket. Throws NOT_FOUND / AUTH_FAILED with stable codes. */
  async getTicket(id, { includeConversations = true } = {}) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new FreshdeskError('INVALID_INPUT', 'ticket_id must be a positive integer.');
    }
    const params = includeConversations ? { include: 'conversations' } : {};
    const data = await this.#request(`/tickets/${id}`, params);
    // Some accounts embed conversations; others need the sub-resource. Both are GET.
    if (includeConversations && data && !Array.isArray(data.conversations)) {
      try {
        const conv = await this.#request(`/tickets/${id}/conversations`, {});
        if (Array.isArray(conv)) data.conversations = conv;
      } catch (err) {
        if (err instanceof FreshdeskError && (err.code === 'NOT_FOUND' || err.code === 'AUTH_FAILED')) throw err;
        // Conversation fetch is best-effort; the ticket itself succeeded.
      }
    }
    return data;
  }

  /** Search tickets with a pre-built query string. Returns { items, page, hasMore }. */
  async searchTickets({ query, page = 1 } = {}) {
    if (typeof query !== 'string' || !query.trim()) {
      throw new FreshdeskError('INVALID_INPUT', 'A search query is required.');
    }
    if (!Number.isInteger(page) || page < 1 || page > 10) {
      throw new FreshdeskError('INVALID_INPUT', 'Search page must be an integer between 1 and 10 (max 300 results).');
    }
    const data = await this.#request('/search/tickets', { query, page });
    const items = Array.isArray(data?.results) ? data.results : [];
    const total = typeof data?.total === 'number' ? data.total : items.length;
    return { items, page, total, hasMore: page < 10 && page * 30 < total };
  }
}
