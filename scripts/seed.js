// seed.js — the ONLY script allowed to write to Freshdesk (POST /tickets).
// Creates 12 fictional tickets in a trial account. src/ never imports this file.
import 'dotenv/config';

const domain = (process.env.FRESHDESK_DOMAIN ?? '').trim();
const apiKey = (process.env.FRESHDESK_API_KEY ?? '').trim();
if (!domain || !apiKey) {
  console.error('Set FRESHDESK_DOMAIN and FRESHDESK_API_KEY (see .env.example).');
  process.exit(1);
}

const base = `https://${domain}.freshdesk.com/api/v2`;
const auth = `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;

// Fictional merchant-support themes. All names/addresses are fake.
const TEMPLATES = [
  ['Refund not received for order #1042', 'Customer reports cancelled order with no refund yet.', ['refund'], 2, 3],
  ['Failed settlement for weekend sales', 'Settlement expected Monday, still pending.', ['settlement'], 2, 4],
  ['Autopay mandate failed twice', 'Two failed autopay attempts for one customer.', ['autopay'], 2, 3],
  ['Chargeback query for order #2087', 'Customer disputes a duplicate charge.', ['chargeback'], 3, 2],
  ['Payment link expired too quickly', 'Link sent to customer expired in minutes.', ['payments'], 2, 3],
  ['GST invoice copy requested (August)', 'Merchant needs August invoice re-sent.', ['invoice'], 4, 1],
  ['Webhook not firing on payment.captured', 'No webhooks since integration update.', ['integration'], 2, 4],
  ['Payout to bank bouncing', 'Consecutive payouts failing for one account.', ['payout'], 3, 3],
  ['QR code payments missing in report', 'Yesterday QR payments absent from daily report.', ['qr-code'], 2, 2],
  ['International cards declined at checkout', 'All international Visa attempts failing.', ['international'], 2, 4],
  ['Dashboard shows wrong currency', 'USD amounts rendered as INR.', ['dashboard'], 4, 1],
  ['Duplicate charge on same order ID', 'Order charged twice; needs verification.', ['duplicate'], 5, 2],
];

let created = 0;
for (const [i, [subject, description, tags, status, priority]] of TEMPLATES.entries()) {
  const payload = {
    subject: `[FICTIONAL] ${subject}`,
    description: `[FICTIONAL SEED DATA] ${description} Fake contact: fake.user${String(i + 1).padStart(2, '0')}@example.com`,
    email: `fake.user${String(i + 1).padStart(2, '0')}@example.com`,
    status, priority, tags,
  };
  const res = await fetch(`${base}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 201) {
    const body = await res.json();
    console.log(`  [OK] #${body.id} — ${subject}`);
    created += 1;
  } else {
    console.log(`  [FAIL ${res.status}] ${subject}: ${(await res.text()).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, 1000)); // stay under the rate limit
}
console.log(`\nDone. ${created}/${TEMPLATES.length} tickets created in ${domain}.freshdesk.com`);
