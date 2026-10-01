// Load and validate environment configuration.
// Secrets come from env vars only. Never log or print the API key.
import 'dotenv/config';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 4;

/**
 * Validate and return connector config.
 * Throws an Error naming the missing variable (without printing secrets).
 */
export function loadConfig(env = process.env) {
  const domain = (env.FRESHDESK_DOMAIN ?? '').trim();
  if (!domain) {
    throw new Error('Missing required env var FRESHDESK_DOMAIN (subdomain only, e.g. "acme"). See .env.example.');
  }
  if (/[^a-zA-Z0-9-]/.test(domain) || domain.includes('.')) {
    throw new Error('Invalid FRESHDESK_DOMAIN: use the subdomain only (e.g. "acme", not "acme.freshdesk.com").');
  }

  const apiKey = (env.FRESHDESK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('Missing required env var FRESHDESK_API_KEY. See .env.example.');
  }

  const baseUrl = (env.FRESHDESK_BASE_URL ?? '').trim() || `https://${domain}.freshdesk.com/api/v2`;

  const timeoutMs = env.REQUEST_TIMEOUT_MS ? Number(env.REQUEST_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid REQUEST_TIMEOUT_MS: must be a positive number of milliseconds.');
  }

  const maxRetries = env.MAX_RETRIES ? Number(env.MAX_RETRIES) : DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('Invalid MAX_RETRIES: must be a non-negative integer.');
  }

  return { domain, apiKey, baseUrl: baseUrl.replace(/\/$/, ''), timeoutMs, maxRetries };
}
