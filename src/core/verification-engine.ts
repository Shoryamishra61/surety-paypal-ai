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

/** Only non-delivery has an autonomous evidence contract in this prototype. */
export class PremiseVerificationEngine {
  private bindingEngine = new RelationshipBindingEngine();
  constructor(private policyVersion = '1.0.0') {}
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
    if (claim.claimType !== ClaimType.NOT_DELIVERED) {
      const reason =
        claim.claimType === ClaimType.DUPLICATE_CHARGE
          ? 'DUPLICATE_LINEAGE_UNRESOLVED'
          : [ClaimType.DAMAGED_ITEM, ClaimType.NOT_AS_DESCRIBED].includes(claim.claimType)
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
}
