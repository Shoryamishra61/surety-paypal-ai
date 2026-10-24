import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { Surety } from '../src/core/surety';
import { SuretyDatabase } from '../src/db/database';
import { ExecutionStore } from '../src/db/execution-store';
import { PayPalSandbox, MerchantRecord } from '../src/providers/paypal';
import { ActionType, ClaimType } from '../src/core/types';

async function main() {
  const order = JSON.parse(readFileSync('artifacts/sandbox-order.json', 'utf8'));
  const auth = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!auth.ok) throw new Error(`Authentication failed (${auth.status})`);
  const token = z.object({ access_token: z.string() }).parse(await auth.json()).access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.id}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Order read failed (${response.status})`);
  let details: any = await response.json();
  if (!['APPROVED', 'COMPLETED'].includes(details.status)) {
    console.log(
      JSON.stringify({
        blocked: 'Buyer approval required',
        orderId: order.id,
        status: details.status,
      }),
    );
    return;
  }
  if (
    details.purchase_units?.length !== 1 ||
    details.purchase_units[0].amount?.currency_code !== 'USD' ||
    details.purchase_units[0].amount?.value !== '1.00'
  )
    throw new Error('Validation only permits the USD 1.00 sandbox purchase');
  if (details.status === 'APPROVED') {
    if (existsSync('artifacts/sandbox-capture-intent.json'))
      throw new Error(
        'Capture already attempted; inspect order before manual recovery. No blind retry.',
      );
    const requestId = `surety-capture-${order.id}`;
    writeFileSync(
      'artifacts/sandbox-capture-intent.json',
      JSON.stringify({ orderId: order.id, requestId, at: new Date().toISOString() }),
    );
    const captured = await fetch(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${order.id}/capture`,
      {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': requestId, Prefer: 'return=representation' },
        body: '{}',
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!captured.ok) throw new Error(`Capture outcome requires inspection (${captured.status})`);
    details = await captured.json();
  }
  const purchase = details.purchase_units?.[0];
  const capture = purchase?.payments?.captures?.[0];
  if (!capture?.id || !purchase?.payee?.merchant_id)
    throw new Error('Captured order lacks required relationship identifiers');
  const record: MerchantRecord = {
    orderId: order.id,
    captureId: capture.id,
    merchantId: purchase.payee.merchant_id,
    customerId: 'SYNTHETIC-SANDBOX-BUYER',
    shipmentId: 'SYNTHETIC-SANDBOX-LOST',
    fulfillmentState: 'LOST',
    observedAt: new Date().toISOString(),
  };
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
      reason: 'Sandbox validation with synthetic LOST fulfillment',
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
    const existing = store.listCases()[0];
    const c = existing ? surety.get(existing.caseId) : await surety.create(action, claim);
    const result = await surety.execute(c.caseId);
    writeFileSync(
      'artifacts/sandbox-validation.json',
      JSON.stringify(
        {
          disclosure:
            'Real PayPal sandbox API; synthetic fulfillment and typed claim, no LLM inference',
          case: result,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        caseId: result.caseId,
        orderId: record.orderId,
        captureId: record.captureId,
        state: result.executionState,
        refundId: result.refundId,
        disclosure: 'Synthetic fulfillment; real sandbox refund API',
      }),
    );
  } finally {
    store.close();
    db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
