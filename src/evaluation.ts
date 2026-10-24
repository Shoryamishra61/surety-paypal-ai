import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PremiseVerificationEngine } from './core/verification-engine';
import { PolicyEngine } from './core/policy-engine';
import {
  ActionType,
  ClaimType,
  EvidenceProvider,
  ProposedAction,
  TypedClaim,
  EvidenceRecord,
} from './core/types';
const verifier = new PremiseVerificationEngine();
const policy = new PolicyEngine();
const results: Record<string, any> = {};
const rows: any[] = [];
for (const state of ['LOST', 'DELIVERED', 'PROCESSING', 'IN_TRANSIT'])
  for (const amount of [1, 49, 51])
    for (const variant of ['normal', 'cross-order', 'untrusted', 'stale', 'subjective']) {
      const adverse = state !== 'LOST' || variant !== 'normal';
      const eligible = state === 'LOST' && variant === 'normal' && amount <= 50;
      const action: ProposedAction = {
        actionType: ActionType.REFUND,
        captureId: 'CAP',
        orderId: 'ORD',
        amount,
        currency: 'USD',
        merchantId: 'M',
        customerId: 'C',
        reason: 'Synthetic scenario',
      };
      const claim: TypedClaim = {
        claimType: variant === 'subjective' ? ClaimType.DAMAGED_ITEM : ClaimType.NOT_DELIVERED,
        orderReference: variant === 'cross-order' ? 'OTHER' : 'ORD',
        captureReference: 'CAP',
        merchantId: 'M',
        customerId: 'C',
        rawStatement: 'Synthetic claim',
        extractedAmount: amount,
        extractedCurrency: 'USD',
        confidence: 0,
      };
      const timestamp = new Date().toISOString();
      const evidence: EvidenceRecord[] = [
        {
          evidenceId: 'capture',
          provider: EvidenceProvider.PAYPAL,
          providerId: 'CAP',
          parentId: 'ORD',
          recordType: 'capture',
          state: 'COMPLETED',
          timestamp,
          data: { amount: 100, currency: 'USD' },
          provenance: 'Synthetic fixture',
        },
        {
          evidenceId: 'order',
          provider: EvidenceProvider.MERCHANT_OMS,
          providerId: 'ORD',
          parentId: null,
          recordType: 'order',
          state: 'RECORDED',
          timestamp,
          data: { merchantId: 'M', customerId: 'C' },
          provenance: 'Synthetic fixture',
        },
        {
          evidenceId: 'shipment',
          provider:
            variant === 'untrusted'
              ? EvidenceProvider.CUSTOMER_REPORTED
              : EvidenceProvider.MERCHANT_OMS,
          providerId: 'SHP',
          parentId: 'ORD',
          recordType: 'shipment',
          state,
          timestamp: variant === 'stale' ? '2000-01-01T00:00:00Z' : timestamp,
          data: {},
          provenance: 'Synthetic fixture',
        },
      ];
      const t = performance.now();
      const verification = verifier.verify(claim, action, evidence);
      const p = policy.evaluate(
        action,
        verification,
        { captureId: 'CAP', captureAmountMinor: 10000, totalRefundedMinor: 0, currency: 'USD' },
        {
          merchantId: 'M',
          customerId: 'C',
          currency: 'USD',
          customerDailyMinor: 0,
          merchantDailyMinor: 0,
        },
      );
      const surety = !p.permitted ? 'DENY' : p.requiresApproval ? 'REVIEW' : verification.decision;
      rows.push({
        id: `${state}-${amount}-${variant}`,
        state,
        amount,
        variant,
        adverse,
        eligible,
        legitimate: state === 'LOST' && variant === 'normal',
        guardLatencyMs: performance.now() - t,
        decisions: {
          'No guard': 'EXECUTE',
          'Amount-only': amount <= 50 ? 'EXECUTE' : 'REVIEW',
          'Human-everything': 'REVIEW',
          Surety: surety,
        },
      });
    }
for (const system of ['No guard', 'Amount-only', 'Human-everything', 'Surety']) {
  const adverse = rows.filter((r) => r.adverse);
  const eligible = rows.filter((r) => r.eligible);
  const legitimate = rows.filter((r) => r.legitimate);
  const rate = (n: number, d: number) => ({ numerator: n, denominator: d, rate: d ? n / d : null });
  results[system] = {
    wrongMoneyMovement: rate(
      adverse.filter((r) => r.decisions[system] === 'EXECUTE').length,
      adverse.length,
    ),
    legitimateAutoResolution: rate(
      eligible.filter((r) => r.decisions[system] === 'EXECUTE').length,
      eligible.length,
    ),
    falseDenial: rate(
      legitimate.filter((r) => r.decisions[system] === 'DENY').length,
      legitimate.length,
    ),
    humanReview: rate(rows.filter((r) => r.decisions[system] === 'REVIEW').length, rows.length),
  };
}
const latencies = rows.map((r) => r.guardLatencyMs).sort((a, b) => a - b);
const report = {
  label: 'SYNTHETIC SPECIFICATION EVALUATION — NOT HELD OUT OR PRODUCTION DATA',
  cases: rows.length,
  createdAt: new Date().toISOString(),
  results,
  guardLatencyMs: {
    p50: latencies[Math.floor(latencies.length * 0.5)],
    p95: latencies[Math.floor(latencies.length * 0.95)],
  },
  liveSandboxReliability: null,
  modelQuality: null,
  caveats: [
    'Self-authored labels and implementation share assumptions.',
    'No guard assumes provider acceptance; no financial provider is called.',
    'Adverse includes unresolved evidence; wrong movement means unsupported execution, not proven fraud.',
    'Human baseline assumes review, not perfect human accuracy.',
    'Only 2 eligible autonomous cases; no external-validity claim.',
  ],
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/evaluation.json', JSON.stringify(report, null, 2));
writeFileSync('artifacts/evaluation-cases.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(report, null, 2));
