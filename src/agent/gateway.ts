// ============================================================
// SURETY — Governed agent gateway.
//
// The ONLY surface through which an AI agent can touch money.
// Agents propose refunds; Surety extracts, binds, verifies, and
// applies policy; execution happens only when the deterministic
// engine says EXECUTE. The agent never sees PayPal credentials
// and can never bypass premise verification — the gateway is
// not a proxy, it is the adjudicator.
// ============================================================

import { z } from 'zod';
import { Surety, EvaluatedCase } from '../core/surety';
import { ClaimExtractor } from '../providers/claim-extractor';
import { ClaimType, ActionType, TypedClaim } from '../core/types';
import { MerchantRecord } from '../providers/paypal';
import { EventBus } from './event-bus';

export const proposalSchema = z
  .object({
    agentId: z.string().min(1).max(100),
    orderId: z.string().min(1),
    statement: z.string().min(1).max(4000),
    amount: z.number().positive(),
    claimType: z.nativeEnum(ClaimType).optional(),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

/** Instruction-shaped content inside a customer message. */
const INJECTION_PATTERNS =
  /(ignore (all )?(previous|prior|above) instructions|system override|disregard your (rules|instructions|operating)|you are now (authorized|the owner|an admin)|do not ask for verification|mark it (as )?approved)/i;

export interface ProposalOutcome {
  agentId: string;
  caseId: string;
  decision: 'EXECUTE' | 'DENY' | 'REVIEW';
  executionState: string;
  refundId: string | null;
  reasonCodes: string[];
  violations: string[];
  injectionSuspected: boolean;
  extractionMode: string;
  amount: number;
  currency: string;
  case: EvaluatedCase;
}

export class GovernedGateway {
  constructor(
    private service: Surety,
    private extractor: ClaimExtractor | null,
    private records: MerchantRecord[],
    private bus: EventBus,
  ) {}

  async propose(input: Proposal): Promise<ProposalOutcome> {
    const record = this.records.find((r) => r.orderId === input.orderId);
    if (!record) throw new Error('Order is not in the authorized merchant record set');
    const injectionSuspected = INJECTION_PATTERNS.test(input.statement);

    let claim: TypedClaim;
    let extractionMode: 'MODEL' | 'MANUAL';
    if (input.claimType) {
      // Caller-supplied typing (deterministic agent fallback). The premise
      // is still verified against records — typing is not trusting.
      claim = {
        claimType: input.claimType,
        orderReference: record.orderId,
        captureReference: record.captureId,
        merchantId: record.merchantId,
        customerId: record.customerId,
        rawStatement: input.statement,
        extractedAmount: input.amount,
        extractedCurrency: 'USD',
        confidence: 0,
      };
      extractionMode = 'MANUAL';
    } else {
      if (!this.extractor)
        throw new Error('No claim extractor configured; supply claimType or configure an LLM provider');
      claim = await this.extractor.extract(input.statement, record);
      extractionMode = 'MODEL';
    }

    const created = await this.service.create(
      {
        actionType: ActionType.REFUND,
        captureId: record.captureId,
        orderId: record.orderId,
        merchantId: record.merchantId,
        customerId: record.customerId,
        amount: input.amount,
        currency: 'USD',
        reason: `Agent ${input.agentId} proposal`,
      },
      claim,
      extractionMode,
      input.agentId,
      injectionSuspected,
    );

    this.bus.publish('gateway.case.created', {
      agentId: input.agentId,
      caseId: created.caseId,
      decision: created.decision,
      amount: input.amount,
      reasonCodes: created.policy.reasonCodes,
      injectionSuspected,
    });

    let final = created;
    if (created.decision === 'EXECUTE') {
      final = await this.service.execute(created.caseId);
      this.bus.publish('gateway.case.executed', {
        agentId: input.agentId,
        caseId: final.caseId,
        executionState: final.executionState,
        refundId: final.refundId,
      });
    } else {
      this.bus.publish(
        created.decision === 'DENY' ? 'gateway.case.denied' : 'gateway.case.review',
        {
          agentId: input.agentId,
          caseId: created.caseId,
          reasonCodes: created.policy.reasonCodes,
          violations: created.policy.violations,
          unresolvedFacts: created.verification.unresolvedFacts,
          injectionSuspected,
        },
      );
      if (injectionSuspected)
        this.bus.publish('system.notice', {
          level: 'warning',
          message:
            'Prompt-injection-shaped content detected in a customer message; proposal was adjudicated under standard evidence rules',
          agentId: input.agentId,
          caseId: created.caseId,
        });
    }

    return {
      agentId: input.agentId,
      caseId: final.caseId,
      decision: final.decision,
      executionState: final.executionState,
      refundId: final.refundId ?? null,
      reasonCodes: [...final.verification.reasonCodes, ...final.policy.reasonCodes],
      violations: final.policy.violations,
      injectionSuspected,
      extractionMode,
      amount: input.amount,
      currency: 'USD',
      case: final,
    };
  }
}
