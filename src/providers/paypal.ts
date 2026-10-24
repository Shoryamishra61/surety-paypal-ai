import { z } from 'zod';
import {
  ClaimType,
  EvidenceRecord,
  EvidenceProvider,
  ProposedAction,
  TypedClaim,
} from '../core/types';
import { PayPalToolkitReader } from './paypal-toolkit';
import {
  SUPPORTED_CURRENCIES,
  formatMinor,
  minorExponent,
  parseMinor,
  toMinor,
} from '../core/money';

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
  facts(action: ProposedAction, claim?: TypedClaim): Promise<FinancialFacts>;
  refund(action: ProposedAction, requestId: string): Promise<RefundResult>;
  getRefund(id: string): Promise<RefundResult>;
}
/** USD-specific helpers kept for compatibility; the engine is currency-aware. */
export function dollarsToMinor(value: number): number {
  return toMinor(value, 'USD');
}
export function parseUsd(value: string): number {
  return parseMinor(value, 'USD');
}
/** Provider money value string for a major-unit amount in the action currency. */
export function providerValueString(amount: number, currency: string): string {
  const exponent = minorExponent(currency);
  const minor = toMinor(amount, currency);
  const absolute = minor.toString().padStart(exponent + 1, '0');
  const whole = absolute.slice(0, absolute.length - exponent) || '0';
  const fraction = exponent ? '.' + absolute.slice(absolute.length - exponent) : '';
  return whole + fraction;
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
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
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
      data: {
        merchantId: record.merchantId,
        customerId: record.customerId,
        ...(record.amount !== undefined ? { amount: record.amount } : {}),
        ...(record.currency ? { currency: record.currency } : {}),
      },
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
const moneySchema = z.object({
  currency_code: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]),
  value: z.string(),
});
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
  private reader: Promise<PayPalToolkitReader | null> | null = null;
  constructor(
    private clientId: string,
    private secret: string,
    private merchantRecords: MerchantRecord[],
    private request: typeof fetch = fetch,
    toolkitReader?: () => Promise<PayPalToolkitReader | null>,
  ) {
    if (!clientId || !secret) throw new Error('PayPal sandbox credentials required');
    this.reader = toolkitReader
      ? toolkitReader().catch((error) => {
          console.warn(
            'PayPal Agent Toolkit unavailable; proceeding without tracking evidence:',
            (error as Error).message,
          );
          return null;
        })
      : null;
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
  async facts(action: ProposedAction, claim?: TypedClaim): Promise<FinancialFacts> {
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
    const reader = this.reader ? await this.reader : null;
    const extraEvidence: EvidenceRecord[] = [];
    if (reader) {
      // Fail-closed: infra failures throw; "no tracking exists" returns null.
      const tracking = await reader.trackingForCapture(action.orderId, action.captureId);
      if (tracking)
        extraEvidence.push(reader.trackingEvidence(action.orderId, action.captureId, tracking));
      const needsSettlements =
        claim?.claimType === ClaimType.DUPLICATE_CHARGE ||
        claim?.claimType === ClaimType.ALREADY_REFUNDED;
      if (needsSettlements) {
        const transactions = await reader.transactions();
        extraEvidence.push(reader.transactionEvidence(action.orderId, transactions));
      }
    }
    return {
      captureAmountMinor: parseMinor(capture.amount.value, capture.amount.currency_code),
      refundedMinor: 0,
      currency: capture.amount.currency_code,
      evidence: [
        {
          evidenceId: `capture:${capture.id}`,
          provider: EvidenceProvider.PAYPAL,
          providerId: capture.id,
          parentId: action.orderId,
          recordType: 'capture',
          state: capture.status,
          timestamp: capture.update_time,
          data: {
            amount:
              parseMinor(capture.amount.value, capture.amount.currency_code) /
              10 ** minorExponent(capture.amount.currency_code),
            currency: capture.amount.currency_code,
          },
          provenance: `PayPal sandbox capture and order GET (${formatMinor(parseMinor(capture.amount.value, capture.amount.currency_code), capture.amount.currency_code)}); timestamp is capture update_time`,
        },
        ...merchantEvidence(record),
        ...extraEvidence,
      ],
    };
  }
  async refund(action: ProposedAction, requestId: string): Promise<RefundResult> {
    toMinor(action.amount, action.currency);
    return refundSchema.parse(
      await this.call(
        `/v2/payments/captures/${encodeURIComponent(action.captureId)}/refund`,
        'POST',
        {
          amount: {
            value: providerValueString(action.amount, action.currency),
            currency_code: action.currency,
          },
        },
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
