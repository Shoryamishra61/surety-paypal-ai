import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const file = 'artifacts/sandbox-order.json';
async function main() {
  const auth = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  const token = (await auth.json()) as { access_token?: string };
  if (!auth.ok || !token.access_token) throw new Error(`Authentication failed (${auth.status})`);
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
    'PayPal-Request-Id': randomUUID(),
  };
  let result: any;
  if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    const response = await fetch(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${stored.id}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    result = await response.json();
    if (!response.ok) throw new Error(`Order lookup failed (${response.status})`);
  } else {
    const response = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: 'surety-sandbox-validation',
            amount: { currency_code: 'USD', value: '1.00' },
            description: 'Surety sandbox refund validation',
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: 'http://127.0.0.1:3100/',
              cancel_url: 'http://127.0.0.1:3100/',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    result = await response.json();
    if (!response.ok)
      throw new Error(
        `Order creation failed (${response.status}): ${result.name || 'provider error'}`,
      );
  }
  writeFileSync(
    file,
    JSON.stringify({ id: result.id, status: result.status, links: result.links }, null, 2),
  );
  console.log(
    JSON.stringify({
      orderId: result.id,
      status: result.status,
      approvalUrl: result.links?.find((l: any) => ['payer-action', 'approve'].includes(l.rel))
        ?.href,
    }),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
