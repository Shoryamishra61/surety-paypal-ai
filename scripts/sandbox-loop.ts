// ============================================================
// SURETY — End-to-end sandbox money loop.
//
// One command, one manual step (buyer approval):
//   1. Create (or reuse) a USD 1.00 sandbox order
//   2. Print the buyer approval link and poll until approved
//   3. Capture with a durable intent file (no blind retries)
//   4. Bind the capture to disclosed synthetic LOST fulfillment
//   5. Adjudicate the refund through Surety and execute it
//   6. Write artifacts/sandbox-loop.json as the evidence record
//
// Usage: npx tsx scripts/sandbox-loop.ts [--timeout-minutes 10]
// ============================================================
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Surety } from '../src/core/surety';
import { SuretyDatabase } from '../src/db/database';
import { ExecutionStore } from '../src/db/execution-store';
import { PayPalSandbox, MerchantRecord } from '../src/providers/paypal';
import { ActionType, ClaimType } from '../src/core/types';

const BASE = 'https://api-m.sandbox.paypal.com';
const ORDER_FILE = 'artifacts/sandbox-order.json';
const CAPTURE_INTENT_FILE = 'artifacts/sandbox-capture-intent.json';
const RESULT_FILE = 'artifacts/sandbox-loop.json';

const args = process.argv.slice(2);
const timeoutIndex = args.indexOf('--timeout-minutes');
const timeoutMinutes = timeoutIndex === -1 ? 10 : Number(args[timeoutIndex + 1] ?? 10);

async function token(): Promise<string> {
  const auth = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
      ).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!auth.ok) throw new Error(`PayPal authentication failed (${auth.status})`);
  return z.object({ access_token: z.string() }).parse(await auth.json()).access_token;
}

async function call(accessToken: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `PayPal ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body.name ?? ''}`,
    );
  return body;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createOrReuseOrder(accessToken: string): Promise<any> {
  if (existsSync(ORDER_FILE)) {
    const stored = JSON.parse(readFileSync(ORDER_FILE, 'utf8'));
    const order = await call(accessToken, `/v2/checkout/orders/${stored.id}`);
    if (['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order.status)) return order;
    console.log(`Stored order ${stored.id} is ${order.status}; creating a fresh order.`);
  }
  const order = await call(accessToken, '/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': randomUUID() },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'surety-sandbox-loop',
          amount: { currency_code: 'USD', value: '1.00' },
          description: 'Surety sandbox refund loop',
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
  });
  writeFileSync(
    ORDER_FILE,
    JSON.stringify({ id: order.id, status: order.status, links: order.links }, null, 2),
  );
  return order;
}

async function main() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET)
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required in .env');
  const accessToken = await token();

  // 1. Order
  let order = await createOrReuseOrder(accessToken);
  console.log(`Order ${order.id} — ${order.status}`);

  // 2. Wait for buyer approval
  if (order.status !== 'COMPLETED') {
    const approvalUrl = order.links?.find((l: any) =>
      ['payer-action', 'approve'].includes(l.rel),
    )?.href;
    if (order.status === 'CREATED' || order.status === 'PAYER_ACTION_REQUIRED') {
      if (!approvalUrl) throw new Error('No approval link on order');
      console.log(
        '\n>>> ACTION REQUIRED: open this link and approve as the sandbox buyer account:',
      );
      console.log(`>>> ${approvalUrl}\n`);
      const deadline = Date.now() + timeoutMinutes * 60_000;
      while (Date.now() < deadline) {
        await sleep(5000);
        // Polling tolerates transient PayPal errors (429/5xx); only a real
        // status change or the deadline ends the wait.
        try {
          order = await call(accessToken, `/v2/checkout/orders/${order.id}`);
        } catch (error) {
          console.log(`Poll retry after transient error: ${(error as Error).message}`);
          continue;
        }
        if (order.status !== 'CREATED' && order.status !== 'PAYER_ACTION_REQUIRED') break;
      }
      if (order.status !== 'APPROVED' && order.status !== 'COMPLETED')
        throw new Error(`Timed out waiting for buyer approval (status ${order.status})`);
      console.log(`Buyer approved — ${order.status}`);
    }
  }

  // 3. Capture (guarded by a durable intent file; never a blind retry)
  let details = order;
  if (details.status === 'APPROVED') {
    if (existsSync(CAPTURE_INTENT_FILE))
      throw new Error(
        'Capture already attempted; inspect the order before manual recovery. No blind retry.',
      );
    const requestId = `surety-capture-${order.id}`;
    writeFileSync(
      CAPTURE_INTENT_FILE,
      JSON.stringify({ orderId: order.id, requestId, at: new Date().toISOString() }, null, 2),
    );
    details = await call(accessToken, `/v2/checkout/orders/${order.id}/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': requestId },
      body: '{}',
    });
    console.log(`Captured — ${details.status}`);
  }
  const purchase = details.purchase_units?.[0];
  const capture = purchase?.payments?.captures?.[0];
  if (!capture?.id || !purchase?.payee?.merchant_id)
    throw new Error('Captured order lacks required relationship identifiers');

  // 4. Disclosed synthetic fulfillment record (LOST) bound to the real capture
  const record: MerchantRecord = {
    orderId: order.id,
    captureId: capture.id,
    merchantId: purchase.payee.merchant_id,
    customerId: 'SYNTHETIC-SANDBOX-BUYER',
    shipmentId: 'SYNTHETIC-SANDBOX-LOST',
    fulfillmentState: 'LOST',
    observedAt: new Date().toISOString(),
  };
  console.log(`Merchant record bound: order ${order.id}, capture ${capture.id}`);

  // 5. Surety adjudication and execution
  const provider = new PayPalSandbox(
    process.env.PAYPAL_CLIENT_ID!,
    process.env.PAYPAL_CLIENT_SECRET!,
    [record],
  );
  const db = new SuretyDatabase('sandbox-validation.db');
  const store = new ExecutionStore('sandbox-validation.db');
  try {
    const surety = new Surety(store, db, provider);
    const action = {
      actionType: ActionType.REFUND,
      captureId: record.captureId,
      orderId: record.orderId,
      merchantId: record.merchantId,
      customerId: record.customerId,
      amount: 1,
      currency: 'USD',
      reason: 'Sandbox loop validation with synthetic LOST fulfillment',
    };
    const claim = {
      claimType: ClaimType.NOT_DELIVERED,
      orderReference: record.orderId,
      captureReference: record.captureId,
      merchantId: record.merchantId,
      customerId: record.customerId,
      rawStatement: 'Synthetic sandbox validation: shipment lost',
      extractedAmount: 1,
      extractedCurrency: 'USD',
      confidence: 0,
    };
    const existing = store
      .listCases()
      .find((c) => (c as any).action?.captureId === record.captureId);
    const created = existing ? surety.get(existing.caseId) : await surety.create(action, claim);
    if (created.decision !== 'EXECUTE')
      throw new Error(
        `Policy declined automatic execution (${created.decision}); inspect the case`,
      );
    const result = await surety.execute(created.caseId);

    // 6. Evidence record
    writeFileSync(
      RESULT_FILE,
      JSON.stringify(
        {
          disclosure:
            'Real PayPal sandbox order, capture, and refund API calls. Fulfillment record and typed claim are disclosed synthetic inputs; no LLM inference in this script.',
          at: new Date().toISOString(),
          order: { id: order.id, status: details.status },
          capture: { id: capture.id, amount: capture.amount },
          case: result,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          caseId: result.caseId,
          orderId: order.id,
          captureId: capture.id,
          decision: result.decision,
          state: result.executionState,
          refundId: result.refundId,
          evidence: RESULT_FILE,
        },
        null,
        2,
      ),
    );
    if (result.executionState !== 'SUCCEEDED')
      throw new Error(`Execution ended in ${result.executionState}; reconcile before any retry`);
  } finally {
    store.close();
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
