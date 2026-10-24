import { describe, it, expect } from 'vitest';
import { PremiseVerificationEngine } from '../src/core/verification-engine';
import { PolicyEngine } from '../src/core/policy-engine';
import { ApprovalEngine } from '../src/core/approval-engine';
import { SuretyDatabase } from '../src/db/database';
import { computeEvidenceDigest, generateIdempotencyKey } from '../src/core/digest';
import {
  ActionType,
  ClaimType,
  EvidenceProvider,
  ProposedAction,
  TypedClaim,
  EvidenceRecord,
} from '../src/core/types';
export const action: ProposedAction = {
  actionType: ActionType.REFUND,
  captureId: 'CAP-A',
  orderId: 'ORD-A',
  amount: 49,
  currency: 'USD',
  merchantId: 'M',
  customerId: 'C',
  reason: 'Refund request',
};
export const claim: TypedClaim = {
  claimType: ClaimType.NOT_DELIVERED,
  orderReference: 'ORD-A',
  captureReference: 'CAP-A',
  customerId: 'C',
  merchantId: 'M',
  rawStatement: 'Not delivered',
  extractedAmount: 49,
  extractedCurrency: 'USD',
  confidence: 1,
};
export function records(state = 'LOST'): EvidenceRecord[] {
  const timestamp = new Date().toISOString();
  return [
    {
      evidenceId: 'capture',
      provider: EvidenceProvider.PAYPAL,
      providerId: 'CAP-A',
      parentId: 'ORD-A',
      recordType: 'capture',
      state: 'COMPLETED',
      timestamp,
      data: { amount: 49, currency: 'USD' },
      provenance: 'Test fixture',
    },
    {
      evidenceId: 'order',
      provider: EvidenceProvider.MERCHANT_OMS,
      providerId: 'ORD-A',
      parentId: null,
      recordType: 'order',
      state: 'COMPLETED',
      timestamp,
      data: { merchantId: 'M', customerId: 'C' },
      provenance: 'Test fixture',
    },
    {
      evidenceId: 'shipment',
      provider: EvidenceProvider.MERCHANT_OMS,
      providerId: 'SHP-A',
      parentId: 'ORD-A',
      recordType: 'shipment',
      state,
      timestamp,
      data: {},
      provenance: 'Test fixture',
    },
  ];
}
const engine = new PremiseVerificationEngine();
describe('financial premise regressions', () => {
  it.each([
    ['LOST', 'EXECUTE'],
    ['DELIVERED', 'DENY'],
    ['PROCESSING', 'REVIEW'],
    ['IN_TRANSIT', 'REVIEW'],
  ])('%s → %s', (s, d) => expect(engine.verify(claim, action, records(s)).decision).toBe(d));
  it('blocks cross-order substitution', () =>
    expect(engine.verify({ ...claim, orderReference: 'ORD-B' }, action, records()).decision).toBe(
      'DENY',
    ));
  it('missing capture cannot authorize', () =>
    expect(engine.verify(claim, action, records().slice(1)).decision).not.toBe('EXECUTE'));
  it('missing capture parent cannot authorize', () => {
    const e = records();
    e[0].parentId = null;
    expect(engine.verify(claim, action, e).decision).not.toBe('EXECUTE');
  });
  it('customer-reported LOST cannot authorize', () => {
    const e = records();
    e[2].provider = EvidenceProvider.CUSTOMER_REPORTED;
    expect(engine.verify(claim, action, e).decision).toBe('REVIEW');
  });
  it('stale LOST cannot authorize', () => {
    const e = records();
    e[2].timestamp = '2000-01-01T00:00:00Z';
    expect(engine.verify(claim, action, e).decision).toBe('REVIEW');
  });
  it('conflicting shipment states require review', () => {
    const e = records();
    e.push({ ...e[2], evidenceId: 'second', providerId: 'SHP-B', state: 'DELIVERED' });
    expect(engine.verify(claim, action, e).decision).toBe('REVIEW');
  });
  it('duplicate claims with insufficient evidence require review', () =>
    expect(
      engine.verify({ ...claim, claimType: ClaimType.DUPLICATE_CHARGE }, action, records())
        .decision,
    ).toBe('REVIEW'));
  it('policy rejects a contradicted premise', () =>
    expect(
      new PolicyEngine().evaluate(
        action,
        engine.verify(claim, action, records('DELIVERED')),
        { captureId: 'CAP-A', captureAmount: 49, totalRefunded: 0, currency: 'USD' },
        null,
      ).permitted,
    ).toBe(false));
  it.each([NaN, Infinity, 0, -1, 0.001])('rejects invalid amount %s', (amount) =>
    expect(
      new PolicyEngine().evaluate(
        { ...action, amount },
        engine.verify(claim, action, records()),
        { captureId: 'CAP-A', captureAmount: 49, totalRefunded: 0, currency: 'USD' },
        null,
      ).permitted,
    ).toBe(false),
  );
  it('missing refund history is not permission', () =>
    expect(
      new PolicyEngine().evaluate(action, engine.verify(claim, action, records()), null, null)
        .permitted,
    ).toBe(false));
  it('evidence data and lineage are digest bound', () => {
    const e = records();
    const before = computeEvidenceDigest(e);
    e[0].data.amount = 100;
    e[0].parentId = 'ORD-B';
    expect(computeEvidenceDigest(e)).not.toBe(before);
  });
  it('request ID is stable across time', async () => {
    const a = generateIdempotencyKey('case', 'REFUND');
    await new Promise((r) => setTimeout(r, 5));
    expect(generateIdempotencyKey('case', 'REFUND')).toBe(a);
  });
  it('approval rejects altered customer and replay', () => {
    const db = new SuretyDatabase(':memory:');
    try {
      const approvals = new ApprovalEngine(db);
      const e = records();
      const a = approvals.createApproval({
        caseId: 'case',
        merchantId: 'M',
        action,
        claim,
        evidence: e,
        policyVersion: '1',
        approvedBy: 'reviewer',
      });
      expect(
        approvals.validateApproval(a.approvalId, { ...action, customerId: 'OTHER' }, claim, e, '1')
          .valid,
      ).toBe(false);
      expect(approvals.validateAndConsume(a.approvalId, action, claim, e, '1').valid).toBe(true);
      expect(approvals.validateAndConsume(a.approvalId, action, claim, e, '1').valid).toBe(false);
    } finally {
      db.close();
    }
  });
});

it('expired approval cannot execute', () => {
  const db = new SuretyDatabase(':memory:');
  try {
    const a = new ApprovalEngine(db);
    const e = records();
    const approval = a.createApproval({
      caseId: 'expired',
      merchantId: 'M',
      action,
      claim,
      evidence: e,
      policyVersion: '1',
      approvedBy: 'reviewer',
      expiresInMs: -1000,
    });
    expect(a.validateAndConsume(approval.approvalId, action, claim, e, '1').valid).toBe(false);
  } finally {
    db.close();
  }
});
it('policy change invalidates approval', () => {
  const db = new SuretyDatabase(':memory:');
  try {
    const a = new ApprovalEngine(db);
    const e = records();
    const approval = a.createApproval({
      caseId: 'changed-policy',
      merchantId: 'M',
      action,
      claim,
      evidence: e,
      policyVersion: '1',
      approvedBy: 'reviewer',
    });
    expect(a.validateAndConsume(approval.approvalId, action, claim, e, '2').valid).toBe(false);
  } finally {
    db.close();
  }
});
it('future-dated evidence requires review', () => {
  const e = records();
  e[2].timestamp = new Date(Date.now() + 3600000).toISOString();
  expect(engine.verify(claim, action, e).decision).toBe('REVIEW');
});
it.each(['RETURNED', 'CANCELLED'])('%s alone does not establish non-delivery', (state) =>
  expect(engine.verify(claim, action, records(state)).decision).toBe('REVIEW'),
);
