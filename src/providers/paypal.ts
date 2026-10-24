import { z } from 'zod';
import { EvidenceRecord, EvidenceProvider, ProposedAction } from '../core/types';

export interface FinancialFacts {
  evidence: EvidenceRecord[];
  captureAmountMinor: number;
  refundedMinor: number;
  currency: string;
}
export interface RefundResult {
  id: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'CANCELLED';
}
export interface PaymentProvider {
  readonly mode: 'SIMULATION' | 'PAYPAL_SANDBOX';
  facts(action: ProposedAction): Promise<FinancialFacts>;
  refund(action: ProposedAction, requestId: string): Promise<RefundResult>;
  getRefund(id: string): Promise<RefundResult>;
}
export function dollarsToMinor(value: number): number {
  const minor = Math.round(value * 100);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(minor) ||
    Math.abs(value * 100 - minor) > 1e-7
  )
    throw new Error('USD amount must have at most two decimal places');
  return minor;
}
export function parseUsd(value: string): number {
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value)) throw new Error('Invalid USD amount');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export const merchantRecordSchema = z
  .object({
    orderId: z.string().min(1),
    captureId: z.string().min(1),
    merchantId: z.string().min(1),
    customerId: z.string().min(1),
    shipmentId: z.string().min(1),
    fulfillmentState: z.enum(['DELIVERED', 'LOST', 'PROCESSING', 'IN_TRANSIT', 'UNKNOWN']),
    observedAt: z.string().datetime(),
  })
  .strict();
export type MerchantRecord = z.infer<typeof merchantRecordSchema>;
export function merchantEvidence(record: MerchantRecord): EvidenceRecord[] {
  return [
    {
      evidenceId: `order:${record.orderId}`,
      provider: EvidenceProvider.MERCHANT_OMS,
      providerId: record.orderId,
      parentId: null,
      recordType: 'order',
      state: 'RECORDED',
      timestamp: record.observedAt,
      data: { merchantId: record.merchantId, customerId: record.customerId },
      provenance: 'Merchant-reported OMS record; not independent delivery proof',
    },
    {
      evidenceId: `shipment:${record.shipmentId}`,
      provider: EvidenceProvider.MERCHANT_OMS,
      providerId: record.shipmentId,
      parentId: record.orderId,
      recordType: 'shipment',
      state: record.fulfillmentState,
      timestamp: record.observedAt,
      data: {},
      provenance: 'Merchant-reported fulfillment; freshness limit 24 hours',
    },
  ];
}
const refundSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['COMPLETED', 'PENDING', 'FAILED', 'CANCELLED']),
});
const moneySchema = z.object({ currency_code: z.literal('USD'), value: z.string() });
const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  update_time: z.string().datetime(),
  amount: moneySchema,
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string() }) }),
});
const orderSchema = z.object({
  id: z.string(),
  purchase_units: z.array(
    z.object({
      payee: z.object({ merchant_id: z.string() }),
      payments: z.object({ captures: z.array(z.object({ id: z.string() })) }),
    }),
  ),
});

/** Sandbox only. No automatic fallback, write retry, or production host selection. */
export class PayPalSandbox implements PaymentProvider {
  readonly mode = 'PAYPAL_SANDBOX' as const;
  constructor(
    private clientId: string,
    private secret: string,
    private merchantRecords: MerchantRecord[],
    private request: typeof fetch = fetch,
  ) {
    if (!clientId || !secret) throw new Error('PayPal sandbox credentials required');
  }
  private async call(
    path: string,
    method = 'GET',
    body?: unknown,
    requestId?: string,
  ): Promise<unknown> {
    const auth = await this.request('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    if (!auth.ok) throw new Error(`PayPal authentication failed (${auth.status})`);
    const token = z
      .object({ access_token: z.string().min(1) })
      .parse(await auth.json()).access_token;
    const response = await this.request(`https://api-m.sandbox.paypal.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`PayPal ${method} failed (${response.status}); reconcile before retry`);
    return response.json();
  }
  async facts(action: ProposedAction): Promise<FinancialFacts> {
    const capture = captureSchema.parse(
      await this.call(`/v2/payments/captures/${encodeURIComponent(action.captureId)}`),
    );
    if (
      capture.id !== action.captureId ||
      capture.supplementary_data.related_ids.order_id !== action.orderId
    )
      throw new Error('PayPal capture/order mismatch');
    // Partial-refund history is not assumed from an incomplete capture response.
    if (capture.status !== 'COMPLETED')
      throw new Error(
        'Only unrefunded COMPLETED captures supported; refund history requires reconciliation',
      );
    const order = orderSchema.parse(
      await this.call(`/v2/checkout/orders/${encodeURIComponent(action.orderId)}`),
    );
    if (
      order.id !== action.orderId ||
      !order.purchase_units.some(
        (p) =>
          p.payee.merchant_id === action.merchantId &&
          p.payments.captures.some((c) => c.id === action.captureId),
      )
    )
      throw new Error('PayPal merchant/capture relationship mismatch');
    const record = this.merchantRecords.find(
      (r) =>
        r.orderId === action.orderId &&
        r.captureId === action.captureId &&
        r.merchantId === action.merchantId &&
        r.customerId === action.customerId,
    );
    if (!record) throw new Error('Trusted merchant relationship record unavailable');
    return {
      captureAmountMinor: parseUsd(capture.amount.value),
      refundedMinor: 0,
      currency: 'USD',
      evidence: [
        {
          evidenceId: `capture:${capture.id}`,
          provider: EvidenceProvider.PAYPAL,
          providerId: capture.id,
          parentId: action.orderId,
          recordType: 'capture',
          state: capture.status,
          timestamp: capture.update_time,
          data: { amount: parseUsd(capture.amount.value) / 100, currency: 'USD' },
          provenance: 'PayPal sandbox capture and order GET; timestamp is capture update_time',
        },
        ...merchantEvidence(record),
      ],
    };
  }
  async refund(action: ProposedAction, requestId: string): Promise<RefundResult> {
    dollarsToMinor(action.amount);
    return refundSchema.parse(
      await this.call(
        `/v2/payments/captures/${encodeURIComponent(action.captureId)}/refund`,
        'POST',
        { amount: { value: action.amount.toFixed(2), currency_code: 'USD' } },
        requestId,
      ),
    );
  }
  async getRefund(id: string): Promise<RefundResult> {
    const result = refundSchema.parse(
      await this.call(`/v2/payments/refunds/${encodeURIComponent(id)}`),
    );
    if (result.id !== id) throw new Error('Refund response ID mismatch');
    return result;
  }
}
