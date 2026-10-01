// Trim raw Freshdesk objects to the agent-facing shape.
// Whitelist only: requester emails, phones, and other personal fields are dropped.
// Free-text fields are additionally masked for common email/phone patterns.
export const STATUS_MAP = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed' };
export const PRIORITY_MAP = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' };

const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE_RE = /(?<!\d)(\+?\d[\d\s-]{7,}\d)(?!\d)/g;

export function maskText(text, limit) {
  if (text == null) return text;
  let out = String(text);
  out = out.replace(EMAIL_RE, '$1***@$2');
  out = out.replace(PHONE_RE, (m) => `***${m.replace(/\D/g, '').slice(-2)}`);
  if (limit && out.length > limit) out = `${out.slice(0, limit)}…[truncated]`;
  return out;
}

export function stripHtml(html) {
  if (html == null) return html;
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Trim one raw ticket. Never includes requester email/phone. */
export function mapTicket(raw = {}) {
  const statusCode = raw.status ?? null;
  const priorityCode = raw.priority ?? null;
  const plain = raw.description_text ?? (raw.description ? stripHtml(raw.description) : null);
  return {
    id: raw.id,
    subject: typeof raw.subject === 'string' && raw.subject.length > 200 ? `${raw.subject.slice(0, 200)}…[truncated]` : raw.subject ?? null,
    status: STATUS_MAP[statusCode] ?? 'other',
    status_code: statusCode,
    priority: PRIORITY_MAP[priorityCode] ?? 'other',
    priority_code: priorityCode,
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    due_by: raw.due_by ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    description_preview: maskText(plain, 300),
  };
}

/** Trim one conversation entry to 500 chars. */
export function mapConversation(raw = {}) {
  const plain = raw.body_text ?? (raw.body ? stripHtml(raw.body) : null);
  return {
    id: raw.id,
    incoming: raw.incoming ?? null,
    private: raw.private ?? null,
    created_at: raw.created_at ?? null,
    body: maskText(plain, 500),
  };
}

/** Map get-ticket output: trimmed ticket + last 5 conversation entries. */
export function mapTicketWithConversations(raw = {}) {
  const ticket = mapTicket(raw);
  const convs = Array.isArray(raw.conversations) ? raw.conversations : [];
  ticket.conversations = convs.slice(-5).map(mapConversation);
  return ticket;
}
