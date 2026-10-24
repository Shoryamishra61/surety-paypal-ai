import { randomUUID } from 'node:crypto';
import { ApprovalEngine } from './approval-engine';
import {
  computeActionDigest,
  computeDigest,
  computeEvidenceDigest,
  generateIdempotencyKey,
} from './digest';
import { PolicyEngine } from './policy-engine';
import { PremiseVerificationEngine } from './verification-engine';
import {
  ProposedAction,
  ProposedActionSchema,
  TypedClaim,
  TypedClaimSchema,
  VerificationResult,
  PolicyResult,
  EvidenceRecord,
} from './types';
import { ExecutionStore, CaseRecord } from '../db/execution-store';
import { SuretyDatabase } from '../db/database';
import { FinancialFacts, PaymentProvider, dollarsToMinor } from '../providers/paypal';

export interface EvaluatedCase extends CaseRecord {
  action: ProposedAction;
  claim: TypedClaim;
  evidence: EvidenceRecord[];
  verification: VerificationResult;
  policy: PolicyResult;
  mode: string;
  decision: 'EXECUTE' | 'DENY' | 'REVIEW';
  executionState: string;
  approvalId: string | null;
  refundId: string | null;
  requestId: string | null;
  evidenceDigest: string;
  policyDigest: string;
  createdAt: string;
  error: string | null;
}
export class Surety {
  readonly approvals: ApprovalEngine;
  readonly policy = new PolicyEngine();
  private verifier = new PremiseVerificationEngine();
  constructor(
    readonly store: ExecutionStore,
    private readonly approvalDatabase: SuretyDatabase,
    readonly provider: PaymentProvider,
  ) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS runtime_configuration(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
    );
    store.db
      .transaction(() => {
        const stored = store.db
          .prepare("SELECT value FROM runtime_configuration WHERE key='provider_mode'")
          .get() as { value: string } | undefined;
        const incompatible = store.listCases().some((c) => c.mode !== provider.mode);
        if ((stored && stored.value !== provider.mode) || incompatible)
          throw new Error('Database mode differs from provider; use a separate database');
        store.db
          .prepare("INSERT OR IGNORE INTO runtime_configuration VALUES('provider_mode',?)")
          .run(provider.mode);
      })
      .immediate();
    this.approvals = new ApprovalEngine(approvalDatabase);
  }
  get(caseId: string): EvaluatedCase {
    const record = this.store.getCase(caseId);
    if (!record) throw new Error('Case not found');
    return record as EvaluatedCase;
  }
  private save(record: EvaluatedCase): EvaluatedCase {
    const previousVersion = this.store.getCase(record.caseId)?.version ?? null;
    record.version = (previousVersion ?? 0) + 1;
    record.previousVersion = previousVersion;
    if (record.approvalId) {
      const approval = this.approvalDatabase.getApproval(record.approvalId);
      record.approvalLifecycle = approval ?? null;
    }
    record.updatedAt = new Date().toISOString();
    this.store.saveCase(record);
    return record;
  }
  private evaluate(claim: TypedClaim, action: ProposedAction, facts: FinancialFacts) {
    const verification = this.verifier.verify(claim, action, facts.evidence);
    const total = (sql: string, ...args: string[]) =>
      Number((this.store.db.prepare(sql).get(...args) as { n: number }).n);
    const localRefunded = total(
      "SELECT COALESCE(SUM(amountMinor),0) n FROM reservations WHERE captureId=? AND state!='FAILED'",
      action.captureId,
    );
    const day = new Date().toISOString().slice(0, 10);
    const customerTotal = total(
      "SELECT COALESCE(SUM(amountMinor),0) n FROM reservations WHERE merchantId=? AND customerId=? AND substr(createdAt,1,10)=? AND state!='FAILED'",
      action.merchantId,
      action.customerId,
      day,
    );
    const merchantTotal = total(
      "SELECT COALESCE(SUM(amountMinor),0) n FROM reservations WHERE merchantId=? AND substr(createdAt,1,10)=? AND state!='FAILED'",
      action.merchantId,
      day,
    );
    const policy = this.policy.evaluate(
      action,
      verification,
      {
        captureId: action.captureId,
        captureAmount: facts.captureAmountMinor / 100,
        totalRefunded: Math.max(facts.refundedMinor, localRefunded) / 100,
        currency: facts.currency,
      },
      {
        customerId: action.customerId,
        merchantId: action.merchantId,
        customerDailyTotal: customerTotal / 100,
        merchantDailyTotal: merchantTotal / 100,
      },
    );
    // Daily totals and concurrent reservations are enforced transactionally at execution.
    const decision =
      !policy.permitted || verification.decision === 'DENY'
        ? 'DENY'
        : policy.requiresApproval
          ? 'REVIEW'
          : 'EXECUTE';
    return { verification, policy, decision } as const;
  }
  async create(
    rawAction: unknown,
    rawClaim: unknown,
    extractionMode: 'MODEL' | 'FIXTURE' | 'MANUAL' = 'MANUAL',
  ): Promise<EvaluatedCase> {
    const action = ProposedActionSchema.parse(rawAction);
    const claim = TypedClaimSchema.parse(rawClaim);
    dollarsToMinor(action.amount);
    const facts = await this.provider.facts(action);
    const evaluated = this.evaluate(claim, action, facts);
    return this.save({
      caseId: randomUUID(),
      claimSchemaVersion: '1',
      extractionMode,
      version: 0,
      action,
      claim,
      evidence: facts.evidence,
      ...evaluated,
      mode: this.provider.mode,
      executionState: 'NOT_EXECUTED',
      approvalId: null,
      refundId: null,
      requestId: null,
      evidenceDigest: computeEvidenceDigest(facts.evidence),
      policyDigest: computeDigest(this.policy.getConfig()),
      createdAt: new Date().toISOString(),
      error: null,
    });
  }
  approve(caseId: string, reviewer: string): EvaluatedCase {
    const record = this.get(caseId);
    if (!reviewer || record.decision !== 'REVIEW' || record.executionState !== 'NOT_EXECUTED')
      throw new Error('Case is not eligible for review approval');
    if (
      record.verification.relationshipBinding.warnings.length ||
      !record.verification.relationshipBinding.valid
    )
      throw new Error('Missing transaction relationships cannot be overridden');
    if (record.approvalId) return record;
    const approval = this.approvals.createApproval({
      caseId,
      merchantId: record.action.merchantId,
      action: record.action,
      claim: record.claim,
      evidence: record.evidence,
      policyVersion: record.policyDigest,
      approvedBy: reviewer,
    });
    this.store.db
      .prepare('INSERT INTO case_approvals(case_id,approval_id) VALUES(?,?)')
      .run(caseId, approval.approvalId);
    return this.save({ ...record, approvalId: approval.approvalId });
  }
  async execute(caseId: string, expectedAction?: unknown): Promise<EvaluatedCase> {
    let record = this.get(caseId);
    if (
      expectedAction &&
      computeActionDigest(ProposedActionSchema.parse(expectedAction)) !==
        computeActionDigest(record.action)
    )
      throw new Error('Action differs from the bound case');
    if (this.store.getReservation(caseId)) return record;
    if (record.decision === 'DENY') throw new Error('Denied case cannot execute');
    let facts: FinancialFacts;
    try {
      facts = await this.provider.facts(record.action);
    } catch (error) {
      return this.save({
        ...record,
        executionState: 'NOT_EXECUTED',
        error: (error as Error).message,
      });
    }
    // Another request may have reserved while external facts were in flight.
    record = this.get(caseId);
    if (this.store.getReservation(caseId)) return record;
    const evaluated = this.evaluate(record.claim, record.action, facts);
    if (evaluated.decision === 'DENY' || evaluated.verification.relationshipBinding.warnings.length)
      throw new Error('Current facts block execution');
    const policyDigest = computeDigest(this.policy.getConfig());
    if (evaluated.decision === 'REVIEW' && !record.approvalId)
      throw new Error('Exact-action human approval required');
    if (record.approvalId) {
      const validation = this.approvals.validateApproval(
        record.approvalId,
        record.action,
        record.claim,
        facts.evidence,
        policyDigest,
      );
      if (!validation.valid) throw new Error(validation.reason);
    }
    const requestId = generateIdempotencyKey(caseId, record.action.actionType);
    const config = this.policy.getConfig();
    this.store.reserve(
      {
        logicalId: caseId,
        captureId: record.action.captureId,
        merchantId: record.action.merchantId,
        customerId: record.action.customerId,
        amountMinor: dollarsToMinor(record.action.amount),
        argsDigest: computeActionDigest(record.action),
        requestId,
        state: 'RESERVED',
        refundId: null,
        approvalId: record.approvalId,
        createdAt: new Date().toISOString(),
      },
      facts.captureAmountMinor,
      facts.refundedMinor,
      dollarsToMinor(config.customerDailyLimit),
      dollarsToMinor(config.merchantDailyLimit),
    );
    if (record.approvalId) {
      const consumed = this.approvals.validateAndConsume(
        record.approvalId,
        record.action,
        record.claim,
        facts.evidence,
        policyDigest,
      );
      if (!consumed.valid) {
        this.store.finish(caseId, 'FAILED', null);
        throw new Error(consumed.reason);
      }
    }
    record = this.save({
      ...record,
      ...evaluated,
      evidence: facts.evidence,
      evidenceDigest: computeEvidenceDigest(facts.evidence),
      policyDigest,
      requestId,
      executionState: 'EXECUTING',
      error: null,
    });
    try {
      const result = await this.provider.refund(record.action, requestId);
      const state =
        result.status === 'COMPLETED'
          ? 'SUCCEEDED'
          : result.status === 'PENDING'
            ? 'PENDING'
            : 'FAILED';
      this.store.finish(caseId, state, result.id);
      return this.save({ ...record, refundId: result.id, executionState: state });
    } catch (error) {
      this.store.finish(caseId, 'PENDING', null);
      return this.save({
        ...record,
        executionState: 'PENDING',
        error: `External outcome uncertain. Do not retry. ${(error as Error).message}`,
      });
    }
  }
  async reconcile(caseId: string): Promise<EvaluatedCase> {
    const record = this.get(caseId);
    const reservation = this.store.getReservation(caseId);
    if (!reservation) return record;
    if (['SUCCEEDED', 'FAILED'].includes(reservation.state)) {
      if (record.executionState === reservation.state && record.refundId === reservation.refundId)
        return record;
      return this.save({
        ...record,
        executionState: reservation.state,
        refundId: reservation.refundId,
        requestId: reservation.requestId,
        error: null,
      });
    }
    if (!reservation.refundId)
      return this.save({
        ...record,
        executionState: 'PENDING',
        error:
          'Refund ID unavailable. Inspect PayPal using the stored request ID; automatic resubmission is disabled.',
      });
    const result = await this.provider.getRefund(reservation.refundId);
    const state =
      result.status === 'COMPLETED'
        ? 'SUCCEEDED'
        : result.status === 'PENDING'
          ? 'PENDING'
          : 'FAILED';
    this.store.finish(caseId, state, result.id);
    return this.save({ ...record, executionState: state, refundId: result.id, error: null });
  }
}
