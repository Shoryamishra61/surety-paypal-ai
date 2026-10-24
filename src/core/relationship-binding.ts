import {
  RelationshipBindingResult,
  RelationshipError,
  EvidenceRecord,
  EvidenceProvider,
  ProposedAction,
  TypedClaim,
} from './types';

export class RelationshipBindingEngine {
  bind(
    action: ProposedAction,
    claim: TypedClaim,
    evidence: EvidenceRecord[],
  ): RelationshipBindingResult {
    const errors: RelationshipError[] = [];
    const warnings: string[] = [];
    const match = (code: string, expected: string, actual: unknown) => {
      if (actual === null || actual === undefined || actual === '')
        warnings.push(`Missing ${code}`);
      else if (actual !== expected)
        errors.push({
          code,
          message: `${code}: record does not match target`,
          expectedId: expected,
          actualId: String(actual),
          relationship: code,
        });
    };
    match('CLAIM_ORDER_MISMATCH', action.orderId, claim.orderReference);
    match('CLAIM_CAPTURE_MISMATCH', action.captureId, claim.captureReference);
    match('CLAIM_MERCHANT_MISMATCH', action.merchantId, claim.merchantId);
    match('CLAIM_CUSTOMER_MISMATCH', action.customerId, claim.customerId);
    const captures = evidence.filter(
      (e) => e.recordType === 'capture' && e.providerId === action.captureId,
    );
    const orders = evidence.filter(
      (e) => e.recordType === 'order' && e.providerId === action.orderId,
    );
    if (captures.length !== 1 || orders.length !== 1)
      warnings.push('Exactly one capture and order record required');
    for (const capture of captures) {
      match('CAPTURE_ORDER_MISMATCH', action.orderId, capture.parentId);
      if (capture.provider !== EvidenceProvider.PAYPAL)
        warnings.push('Capture must originate from PayPal');
    }
    for (const order of orders) {
      match('ORDER_MERCHANT_MISMATCH', action.merchantId, order.data.merchantId);
      match('ORDER_CUSTOMER_MISMATCH', action.customerId, order.data.customerId);
      if (
        order.provider !== EvidenceProvider.MERCHANT_OMS &&
        order.provider !== EvidenceProvider.PAYPAL
      )
        warnings.push('Order source untrusted');
    }
    for (const record of evidence) {
      if (['shipment', 'fulfillment'].includes(record.recordType))
        match('SHIPMENT_ORDER_MISMATCH', action.orderId, record.parentId);
      if (record.recordType === 'refund')
        match('REFUND_CAPTURE_MISMATCH', action.captureId, record.parentId);
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      graph: evidence
        .filter((e) => ['capture', 'order', 'shipment', 'refund'].includes(e.recordType))
        .map((e) => ({
          id: e.providerId,
          type: e.recordType as 'capture' | 'order' | 'shipment' | 'refund',
          provider: e.provider,
          providerId: e.providerId,
          parentId: e.parentId,
          state: e.state,
          metadata: e.data,
        })),
    };
  }
  isEvidenceRelevant(e: EvidenceRecord, action: ProposedAction): boolean {
    if (e.recordType === 'capture')
      return e.providerId === action.captureId && e.parentId === action.orderId;
    if (e.recordType === 'order') return e.providerId === action.orderId;
    if (['shipment', 'fulfillment'].includes(e.recordType)) return e.parentId === action.orderId;
    if (e.recordType === 'refund') return e.parentId === action.captureId;
    if (e.recordType === 'transactions') return e.providerId === action.orderId;
    return false;
  }
  filterRelevantEvidence(evidence: EvidenceRecord[], action: ProposedAction): EvidenceRecord[] {
    return evidence.filter((e) => this.isEvidenceRelevant(e, action));
  }
}
