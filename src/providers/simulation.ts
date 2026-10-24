// ============================================================
// SURETY — Simulation provider.
//
// Deterministic, seeded scenarios mirroring the evidence shape
// of the live PayPal adapter: captures, orders with amounts,
// shipment records, and settlement history. Every record carries
// an explicit SIMULATION provenance label.
// ============================================================

import { ClaimType, EvidenceProvider, ProposedAction } from '../core/types';
import type { EvidenceRecord, TypedClaim } from '../core/types';
import { FinancialFacts, MerchantRecord, PaymentProvider, RefundResult } from './paypal';

export interface SimScenario {
  id: string;
  title: string;
  /** The customer message exactly as the fixture uses it */
  statement: string;
  claimType: ClaimType;
  state: MerchantRecord['fulfillmentState'];
  /** Amount the customer claims */
  amount: number;
  /** Amount on the order */
  orderAmount: number;
  /** Amount actually captured (defaults to orderAmount) */
  captureAmount?: number;
  /** A second same-amount capture for the same payer (duplicate charge) */
  duplicateCaptureId?: string;
  /** Amount already refunded on this capture before the case */
  priorRefund?: number;
}

export const demoScenarios: SimScenario[] = [
  {
    id: 'delivered',
    title: 'A false non-delivery claim',
    statement: 'My package never arrived. Refund $49.',
    claimType: ClaimType.NOT_DELIVERED,
    state: 'DELIVERED',
    amount: 49,
    orderAmount: 49,
  },
  {
    id: 'lost',
    title: 'A lost shipment supported by records',
    statement: 'My package never arrived. Refund $49.',
    claimType: ClaimType.NOT_DELIVERED,
    state: 'LOST',
    amount: 49,
    orderAmount: 49,
  },
  {
    id: 'damaged',
    title: 'A judgment that belongs to a person',
    statement: 'The item arrived damaged. Please refund $49.',
    claimType: ClaimType.DAMAGED_ITEM,
    state: 'DELIVERED',
    amount: 49,
    orderAmount: 49,
  },
  {
    id: 'processing',
    title: 'Not delivered yet is not proof of loss',
    statement: 'My package never arrived. Refund $49.',
    claimType: ClaimType.NOT_DELIVERED,
    state: 'PROCESSING',
    amount: 49,
    orderAmount: 49,
  },
  {
    id: 'duplicate',
    title: 'A real duplicate charge',
    statement: 'You charged me twice for order duplicate. Refund the second $49.',
    claimType: ClaimType.DUPLICATE_CHARGE,
    state: 'DELIVERED',
    amount: 49,
    orderAmount: 49,
    duplicateCaptureId: 'SIM-CAP-duplicate-2',
  },
  {
    id: 'duplicate-single',
    title: 'A duplicate claim with one charge',
    statement: 'You charged me twice for this order. Refund $49.',
    claimType: ClaimType.DUPLICATE_CHARGE,
    state: 'DELIVERED',
    amount: 49,
    orderAmount: 49,
  },
  {
    id: 'refunded',
    title: 'A second refund for the same purchase',
    statement: 'I never got my money back. Refund $49 again.',
    claimType: ClaimType.ALREADY_REFUNDED,
    state: 'DELIVERED',
    amount: 49,
    orderAmount: 49,
    priorRefund: 49,
  },
  {
    id: 'wrong-amount',
    title: 'Charged more than the order said',
    statement: 'The order said $39 but you charged me $49. Refund the difference.',
    claimType: ClaimType.WRONG_AMOUNT,
    state: 'DELIVERED',
    amount: 10,
    orderAmount: 39,
    captureAmount: 49,
  },
  {
    id: 'bulk',
    title: 'A high-value lost shipment beyond the agent cap',
    statement: 'My camera lens order never arrived. Please refund the $600 I paid.',
    claimType: ClaimType.NOT_DELIVERED,
    state: 'LOST',
    amount: 600,
    orderAmount: 649,
  },
];

export function scenarioRecord(scenario: SimScenario): MerchantRecord {
  return {
    orderId: `SIM-ORD-${scenario.id}`,
    captureId: `SIM-CAP-${scenario.id}`,
    merchantId: 'SIM-MERCHANT',
    customerId: 'SIM-CUSTOMER',
    shipmentId: `SIM-SHP-${scenario.id}`,
    fulfillmentState: scenario.state,
    observedAt: new Date().toISOString(),
  };
}

export class SimulationProvider implements PaymentProvider {
  readonly mode = 'SIMULATION' as const;
  readonly refunds = new Map<string, RefundResult>();
  calls = 0;
  constructor(readonly records: MerchantRecord[]) {}

  private scenarioFor(orderId: string): SimScenario | undefined {
    return demoScenarios.find((s) => `SIM-ORD-${s.id}` === orderId);
  }

  async facts(action: ProposedAction, _claim?: TypedClaim): Promise<FinancialFacts> {
    const record = this.records.find((r) => r.captureId === action.captureId);
    if (!record) throw new Error('Simulation capture not found');
    const scenario = this.scenarioFor(record.orderId);
    const captureAmount = scenario?.captureAmount ?? scenario?.orderAmount ?? 49;
    const priorRefundMinor = Math.round((scenario?.priorRefund ?? 0) * 100);
    const now = record.observedAt;
    const evidence: EvidenceRecord[] = [
      {
        evidenceId: `capture:${record.captureId}`,
        provider: EvidenceProvider.PAYPAL,
        providerId: record.captureId,
        parentId: record.orderId,
        recordType: 'capture',
        state: 'COMPLETED',
        timestamp: now,
        data: { amount: captureAmount, currency: 'USD' },
        provenance: 'SIMULATION fixture; no PayPal API called',
      },
      {
        evidenceId: `order:${record.orderId}`,
        provider: EvidenceProvider.PAYPAL,
        providerId: record.orderId,
        parentId: null,
        recordType: 'order',
        state: 'RECORDED',
        timestamp: now,
        data: {
          merchantId: record.merchantId,
          customerId: record.customerId,
          amount: scenario?.orderAmount ?? 49,
          currency: 'USD',
        },
        provenance: 'SIMULATION fixture order; amount is the ordered amount',
      },
      {
        evidenceId: `shipment:${record.shipmentId}`,
        provider: EvidenceProvider.MERCHANT_OMS,
        providerId: record.shipmentId,
        parentId: record.orderId,
        recordType: 'shipment',
        state: record.fulfillmentState,
        timestamp: now,
        data: {},
        provenance: `SIMULATION fixture fulfillment: merchant-reported fulfillment; freshness limit 24 hours`,
      },
    ];
    if (scenario) {
      const transactions: unknown[] = [
        {
          kind: 'CAPTURE',
          transactionId: record.captureId,
          eventCode: 'T0007',
          status: 'S',
          amount: captureAmount.toFixed(2),
          currency: 'USD',
          initiatedAt: now,
          payerEmail: 'sim-customer@example.com',
        },
      ];
      if (scenario.duplicateCaptureId)
        transactions.push({
          kind: 'CAPTURE',
          transactionId: scenario.duplicateCaptureId,
          eventCode: 'T0007',
          status: 'S',
          amount: captureAmount.toFixed(2),
          currency: 'USD',
          initiatedAt: now,
          payerEmail: 'sim-customer@example.com',
        });
      if (priorRefundMinor > 0)
        transactions.push({
          kind: 'REFUND',
          transactionId: `SIM-REFUND-${scenario.id}`,
          eventCode: 'T0008',
          status: 'S',
          amount: (priorRefundMinor / 100).toFixed(2),
          currency: 'USD',
          initiatedAt: now,
          payerEmail: 'sim-customer@example.com',
        });
      evidence.push({
        evidenceId: `pp-transactions:${record.orderId}`,
        provider: EvidenceProvider.PAYPAL,
        providerId: record.orderId,
        parentId: record.orderId,
        recordType: 'transactions',
        state: 'RECORDED',
        timestamp: now,
        data: { transactions, windowDays: 30 },
        provenance: `SIMULATION fixture settlement history (${transactions.length} records, 30-day window)`,
      });
    }
    return {
      captureAmountMinor: Math.round(captureAmount * 100),
      refundedMinor: priorRefundMinor,
      currency: 'USD',
      evidence,
    };
  }
  async refund(_action: ProposedAction, requestId: string): Promise<RefundResult> {
    this.calls++;
    const existing = this.refunds.get(requestId);
    if (existing) return existing;
    const result: RefundResult = { id: `SIM-${requestId}`, status: 'COMPLETED' };
    this.refunds.set(requestId, result);
    return result;
  }
  async getRefund(id: string): Promise<RefundResult> {
    const result = [...this.refunds.values()].find((r) => r.id === id);
    if (!result) throw new Error('Simulation refund unavailable');
    return result;
  }
}
