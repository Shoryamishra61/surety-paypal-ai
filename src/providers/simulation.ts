import { EvidenceProvider, ProposedAction } from '../core/types';
import {
  FinancialFacts,
  MerchantRecord,
  PaymentProvider,
  RefundResult,
  merchantEvidence,
} from './paypal';

export const demoScenarios = [
  {
    id: 'delivered',
    title: 'The allowed refund with a false premise',
    statement: 'My package never arrived. Refund $49.',
    state: 'DELIVERED',
  },
  {
    id: 'lost',
    title: 'A lost shipment, supported by records',
    statement: 'My package never arrived. Refund $49.',
    state: 'LOST',
  },
  {
    id: 'damaged',
    title: 'A judgment that belongs to a person',
    statement: 'The item arrived damaged. Please refund $49.',
    state: 'DELIVERED',
  },
  {
    id: 'processing',
    title: 'Not delivered yet is not proof of loss',
    statement: 'My package never arrived. Refund $49.',
    state: 'PROCESSING',
  },
] as const;
export class SimulationProvider implements PaymentProvider {
  readonly mode = 'SIMULATION' as const;
  readonly refunds = new Map<string, RefundResult>();
  calls = 0;
  constructor(readonly records: MerchantRecord[]) {}
  async facts(action: ProposedAction): Promise<FinancialFacts> {
    const record = this.records.find((r) => r.captureId === action.captureId);
    if (!record) throw new Error('Simulation capture not found');
    return {
      captureAmountMinor: 4900,
      refundedMinor: 0,
      currency: 'USD',
      evidence: [
        {
          evidenceId: `capture:${record.captureId}`,
          provider: EvidenceProvider.PAYPAL,
          providerId: record.captureId,
          parentId: record.orderId,
          recordType: 'capture',
          state: 'COMPLETED',
          timestamp: record.observedAt,
          data: { amount: 49, currency: 'USD' },
          provenance: 'SIMULATION fixture; no PayPal API called',
        },
        ...merchantEvidence(record).map((e) => ({
          ...e,
          provenance: `SIMULATION fixture: ${e.provenance}`,
        })),
      ],
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
