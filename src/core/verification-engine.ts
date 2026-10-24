// ============================================================
// SURETY — Premise verification engine.
//
// Each claim type has an explicit evidence contract:
//   NOT_DELIVERED    fresh, consistent, trusted delivery records
//   DUPLICATE_CHARGE settlement history shows ≥2 same-amount
//                    captures for the payer, none yet refunded
//   ALREADY_REFUNDED settlement history shows a completed refund
//                    of the claimed amount (blocks double refunds)
//   WRONG_AMOUNT     capture amount vs ordered amount
//   everything else  subjective → human review, never automation
// ============================================================

import {
  ClaimType,
  PremiseVerdict,
  ExecutionDecision,
  EvidenceRecord,
  EvidenceProvider,
  ProposedAction,
  TypedClaim,
  VerificationResult,
} from './types';
import { RelationshipBindingEngine } from './relationship-binding';
import { minorExponent, parseMinor, toMinor } from './money';

interface SettlementLike {
  kind?: string;
  transactionId?: string;
  amount?: string;
  currency?: string;
  status?: string;
}

export class PremiseVerificationEngine {
  private bindingEngine = new RelationshipBindingEngine();
  constructor(private policyVersion = '2.0.0') {}
  verify(
    claim: TypedClaim,
    action: ProposedAction,
    evidence: EvidenceRecord[],
  ): VerificationResult {
    const binding = this.bindingEngine.bind(action, claim, evidence);
    const relevant = this.bindingEngine.filterRelevantEvidence(evidence, action);
    const result = (
      verdict: PremiseVerdict,
      reasonCodes: string[],
      unresolvedFacts: string[] = [],
    ): VerificationResult => ({
      verdict,
      decision:
        verdict === PremiseVerdict.CONTRADICTED
          ? ExecutionDecision.DENY
          : verdict === PremiseVerdict.VERIFIED
            ? ExecutionDecision.EXECUTE
            : ExecutionDecision.REVIEW,
      reasonCodes,
      unresolvedFacts,
      evidenceUsed: relevant,
      relationshipBinding: binding,
      claimType: claim.claimType,
      policyVersion: this.policyVersion,
    });
    if (!binding.valid)
      return result(
        PremiseVerdict.CONTRADICTED,
        ['RELATIONSHIP_MISMATCH', ...binding.errors.map((e) => e.code)],
        binding.errors.map((e) => e.message),
      );
    if (binding.warnings.length)
      return result(PremiseVerdict.UNKNOWN, ['INCOMPLETE_RELATIONSHIPS'], binding.warnings);

    switch (claim.claimType) {
      case ClaimType.NOT_DELIVERED:
        return this.verifyNotDelivered(result, relevant);
      case ClaimType.DUPLICATE_CHARGE:
        return this.verifyDuplicateCharge(result, action, relevant);
      case ClaimType.ALREADY_REFUNDED:
        return this.verifyAlreadyRefunded(result, action, relevant);
      case ClaimType.WRONG_AMOUNT:
        return this.verifyWrongAmount(result, action, relevant);
      default: {
        const reason =
          claim.claimType === ClaimType.DAMAGED_ITEM ||
          claim.claimType === ClaimType.NOT_AS_DESCRIBED
            ? 'SUBJECTIVE_CLAIM'
            : 'UNSUPPORTED_AUTOMATION';
        return result(
          PremiseVerdict.UNKNOWN,
          [reason],
          [
            'This claim requires human investigation; transaction records alone do not establish the premise.',
          ],
        );
      }
    }
  }

  private verifyNotDelivered(
    result: (v: PremiseVerdict, r: string[], u?: string[]) => VerificationResult,
    relevant: EvidenceRecord[],
  ): VerificationResult {
    const delivery = relevant.filter((e) => ['shipment', 'fulfillment'].includes(e.recordType));
    if (!delivery.length)
      return result(
        PremiseVerdict.UNKNOWN,
        ['NO_DELIVERY_EVIDENCE'],
        ['No linked shipment record'],
      );
    const now = Date.now();
    const freshTrusted = delivery.every(
      (e) =>
        [EvidenceProvider.MERCHANT_OMS, EvidenceProvider.CARRIER].includes(e.provider) &&
        Number.isFinite(Date.parse(e.timestamp)) &&
        now - Date.parse(e.timestamp) <= 86400000 &&
        Date.parse(e.timestamp) <= now + 60000,
    );
    if (!freshTrusted || new Set(delivery.map((e) => e.state)).size !== 1)
      return result(
        PremiseVerdict.UNKNOWN,
        ['UNTRUSTED_STALE_OR_CONFLICTING_EVIDENCE'],
        ['Fresh, consistent authoritative delivery records required'],
      );
    if (delivery[0].state === 'DELIVERED')
      return result(PremiseVerdict.CONTRADICTED, [
        'DELIVERY_CONFIRMED',
        `SOURCE:${delivery[0].provider}`,
      ]);
    if (delivery[0].state === 'LOST')
      return result(PremiseVerdict.VERIFIED, ['SHIPMENT_LOST', `SOURCE:${delivery[0].provider}`]);
    return result(
      PremiseVerdict.UNKNOWN,
      ['DELIVERY_UNRESOLVED'],
      [`Shipment state ${delivery[0].state} does not establish terminal non-delivery`],
    );
  }

  private settlements(relevant: EvidenceRecord[]): SettlementLike[] {
    return relevant
      .filter((e) => e.recordType === 'transactions')
      .flatMap((e) =>
        Array.isArray((e.data as { transactions?: unknown }).transactions)
          ? ((e.data as { transactions: unknown[] }).transactions as SettlementLike[])
          : [],
      );
  }

  private verifyDuplicateCharge(
    result: (v: PremiseVerdict, r: string[], u?: string[]) => VerificationResult,
    action: ProposedAction,
    relevant: EvidenceRecord[],
  ): VerificationResult {
    const transactions = this.settlements(relevant);
    if (!transactions.length)
      return result(
        PremiseVerdict.UNKNOWN,
        ['NO_TRANSACTION_HISTORY'],
        ['Duplicate-charge claims require settlement history'],
      );
    const amountMinor = toMinor(action.amount, action.currency);
    const sameAmount = transactions.filter(
      (t) =>
        t.kind === 'CAPTURE' &&
        t.status === 'S' &&
        t.currency === action.currency &&
        t.amount !== undefined &&
        parseMinor(t.amount, t.currency) === amountMinor,
    );
    const refundedSameAmount = transactions.some(
      (t) =>
        t.kind === 'REFUND' &&
        t.status === 'S' &&
        t.currency === action.currency &&
        t.amount !== undefined &&
        parseMinor(t.amount, t.currency) === amountMinor,
    );
    if (sameAmount.length === 1)
      return result(
        PremiseVerdict.CONTRADICTED,
        ['SINGLE_CAPTURE_ONLY'],
        [
          'Settlement history shows one capture for this amount; the customer was not charged twice',
        ],
      );
    if (sameAmount.length >= 2 && refundedSameAmount)
      return result(
        PremiseVerdict.UNKNOWN,
        ['DUPLICATE_ALREADY_REFUNDED'],
        ['A same-amount refund already exists; a further refund requires review'],
      );
    if (sameAmount.length >= 2 && sameAmount.some((t) => t.transactionId === action.captureId))
      return result(PremiseVerdict.VERIFIED, [
        'DUPLICATE_CAPTURE_CONFIRMED',
        `CAPTURES:${sameAmount.length}`,
      ]);
    return result(
      PremiseVerdict.UNKNOWN,
      ['DUPLICATE_TARGET_UNRESOLVED'],
      ['Duplicate captures exist but the proposed capture is not one of them; review required'],
    );
  }

  private verifyAlreadyRefunded(
    result: (v: PremiseVerdict, r: string[], u?: string[]) => VerificationResult,
    action: ProposedAction,
    relevant: EvidenceRecord[],
  ): VerificationResult {
    const transactions = this.settlements(relevant);
    if (!transactions.length)
      return result(
        PremiseVerdict.UNKNOWN,
        ['NO_TRANSACTION_HISTORY'],
        ['Refund-history claims require settlement history'],
      );
    const amountMinor = toMinor(action.amount, action.currency);
    const priorRefund = transactions.some(
      (t) =>
        t.kind === 'REFUND' &&
        t.status === 'S' &&
        t.currency === action.currency &&
        t.amount !== undefined &&
        parseMinor(t.amount, t.currency) === amountMinor,
    );
    if (priorRefund)
      return result(
        PremiseVerdict.CONTRADICTED,
        ['PRIOR_REFUND_CONFIRMED'],
        [
          'Settlement history shows a completed refund of this amount; paying again would double-refund',
        ],
      );
    return result(
      PremiseVerdict.UNKNOWN,
      ['NO_PRIOR_REFUND_FOUND'],
      [
        'No completed refund found for this amount; the claim may relate to a pending refund or different amount',
      ],
    );
  }

  private verifyWrongAmount(
    result: (v: PremiseVerdict, r: string[], u?: string[]) => VerificationResult,
    action: ProposedAction,
    relevant: EvidenceRecord[],
  ): VerificationResult {
    const capture = relevant.find((e) => e.recordType === 'capture');
    const order = relevant.find((e) => e.recordType === 'order');
    const captureMinor = this.amountMinorOf(capture, action.currency);
    const orderMinor = this.amountMinorOf(order, action.currency);
    if (captureMinor === null || orderMinor === null)
      return result(
        PremiseVerdict.UNKNOWN,
        ['AMOUNT_EVIDENCE_MISSING'],
        ['Both the captured amount and the ordered amount are required'],
      );
    if (captureMinor === orderMinor)
      return result(
        PremiseVerdict.CONTRADICTED,
        ['CHARGE_MATCHES_ORDER'],
        ['The capture matches the ordered amount; the charge is not demonstrably wrong'],
      );
    const difference = (captureMinor - orderMinor) / 10 ** minorExponent(action.currency);
    return result(
      PremiseVerdict.UNKNOWN,
      ['AMOUNT_DISCREPANCY_CONFIRMED'],
      [
        `Capture and order amounts differ (${difference} ${action.currency}); a human decides the refund amount`,
      ],
    );
  }

  private amountMinorOf(record: EvidenceRecord | undefined, currency: string): number | null {
    if (!record) return null;
    const amount = (record.data as { amount?: unknown }).amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    return toMinor(amount, currency);
  }
}
