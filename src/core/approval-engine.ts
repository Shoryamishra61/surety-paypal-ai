// ============================================================
// SURETY — Approval Engine
// Security primitive for human review cases.
//
// INVARIANTS:
// - Approvals bind to exact action arguments (action_args_digest)
// - Approvals bind to exact claim content (claim_digest)
// - Approvals bind to exact evidence state (evidence_digest)
// - Approvals are single-consumption (PENDING → CONSUMED is atomic)
// - Expired approvals cannot be consumed
// - Changed action arguments after approval → DENY
// ============================================================

import { SuretyDatabase } from '../db/database';
import {
  ApprovalRecord,
  ApprovalStatus,
  ActionType,
  ProposedAction,
  TypedClaim,
  EvidenceRecord,
} from './types';
import {
  generateId,
  computeActionDigest,
  computeClaimDigest,
  computeEvidenceDigest,
} from './digest';

export interface ApprovalRequest {
  caseId: string;
  merchantId: string;
  action: ProposedAction;
  claim: TypedClaim;
  evidence: EvidenceRecord[];
  policyVersion: string;
  expiresInMs?: number; // Default: 30 minutes
  approvedBy?: string;
}

export interface ApprovalValidation {
  valid: boolean;
  reason: string;
  approval?: ApprovalRecord;
}

const DEFAULT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export class ApprovalEngine {
  private db: SuretyDatabase;

  constructor(db: SuretyDatabase) {
    this.db = db;
  }

  /**
   * Create a new approval record bound to exact action arguments.
   */
  createApproval(request: ApprovalRequest): ApprovalRecord {
    if (!request.approvedBy || request.merchantId !== request.action.merchantId) {
      throw new Error('An authenticated reviewer and matching merchant are required');
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (request.expiresInMs ?? DEFAULT_EXPIRY_MS));

    const actionDigest = computeActionDigest(request.action);

    const claimDigest = computeClaimDigest(request.claim);

    const evidenceDigest = computeEvidenceDigest(request.evidence);

    const approvalId = generateId('APR');
    const record: ApprovalRecord = {
      approvalId,
      caseId: request.caseId,
      merchantId: request.merchantId,
      actionType: request.action.actionType,
      targetCaptureId: request.action.captureId,
      targetOrderId: request.action.orderId,
      exactAmount: request.action.amount,
      currency: request.action.currency,
      actionArgsDigest: actionDigest,
      claimDigest: claimDigest,
      evidenceDigest: evidenceDigest,
      policyVersion: request.policyVersion,
      status: ApprovalStatus.PENDING,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      consumedAt: null,
      approvedBy: request.approvedBy || null,
      version: 1,
    };

    // Persist to database
    this.db.createApproval({
      approval_id: record.approvalId,
      case_id: record.caseId,
      merchant_id: record.merchantId,
      action_type: record.actionType,
      target_capture_id: record.targetCaptureId,
      target_order_id: record.targetOrderId,
      exact_amount: record.exactAmount,
      currency: record.currency,
      action_args_digest: record.actionArgsDigest,
      claim_digest: record.claimDigest,
      evidence_digest: record.evidenceDigest,
      policy_version: record.policyVersion,
      status: record.status,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
      consumed_at: record.consumedAt,
      approved_by: record.approvedBy,
      version: record.version,
    });

    return record;
  }

  /**
   * Validate an approval for consumption.
   *
   * This performs ALL required checks BEFORE attempting atomic consumption:
   * 1. Approval exists
   * 2. Status is PENDING
   * 3. Not expired
   * 4. Action arguments match exactly (digest comparison)
   * 5. Claim content matches (digest comparison)
   * 6. Evidence state matches (digest comparison)
   * 7. Policy version matches
   *
   * SECURITY: Any mismatch → DENY. No fuzzy approvals.
   */
  validateApproval(
    approvalId: string,
    action: ProposedAction,
    claim: TypedClaim,
    evidence: EvidenceRecord[],
    policyVersion: string,
  ): ApprovalValidation {
    // Expire any stale approvals first
    this.db.expirePendingApprovals(new Date().toISOString());

    // Fetch the approval
    const row = this.db.getApproval(approvalId);
    if (!row) {
      return { valid: false, reason: 'Approval not found' };
    }

    const approval = this.rowToApproval(row);

    // Check status
    if (approval.status !== ApprovalStatus.PENDING) {
      return {
        valid: false,
        reason: `Approval status is ${approval.status}, not PENDING`,
        approval,
      };
    }

    // Check expiration
    if (new Date(approval.expiresAt) < new Date()) {
      return { valid: false, reason: 'Approval has expired', approval };
    }

    // Check action arguments digest — THE critical binding check
    const currentActionDigest = computeActionDigest(action);

    if (currentActionDigest !== approval.actionArgsDigest) {
      return {
        valid: false,
        reason:
          'Action arguments have changed since approval was granted. ' +
          'Approved action does not match current action.',
        approval,
      };
    }

    // Check claim digest
    const currentClaimDigest = computeClaimDigest(claim);

    if (currentClaimDigest !== approval.claimDigest) {
      return {
        valid: false,
        reason: 'Claim content has changed since approval was granted',
        approval,
      };
    }

    // Check evidence digest
    const currentEvidenceDigest = computeEvidenceDigest(evidence);

    if (currentEvidenceDigest !== approval.evidenceDigest) {
      return {
        valid: false,
        reason: 'Evidence state has changed since approval was granted',
        approval,
      };
    }

    // Check policy version
    if (policyVersion !== approval.policyVersion) {
      return {
        valid: false,
        reason: `Policy version changed from ${approval.policyVersion} to ${policyVersion}`,
        approval,
      };
    }

    return { valid: true, reason: 'Approval valid', approval };
  }

  /**
   * Atomically consume an approval.
   *
   * SECURITY INVARIANT: This is the ONLY path through which an
   * approval transitions from PENDING to CONSUMED. The database
   * enforces that this can only happen once via optimistic concurrency.
   *
   * Returns true if consumption succeeded.
   * Returns false if the approval was already consumed by another
   * concurrent request (race condition defense).
   */
  consumeApproval(approvalId: string, expectedVersion: number): boolean {
    return this.db.consumeApproval(approvalId, expectedVersion, new Date().toISOString());
  }

  /**
   * Full approval consumption flow: validate + atomically consume.
   *
   * This is the recommended entry point for consuming approvals.
   */
  validateAndConsume(
    approvalId: string,
    action: ProposedAction,
    claim: TypedClaim,
    evidence: EvidenceRecord[],
    policyVersion: string,
  ): ApprovalValidation {
    const validation = this.validateApproval(approvalId, action, claim, evidence, policyVersion);

    if (!validation.valid || !validation.approval) {
      return validation;
    }

    // Atomically consume — this is the concurrency defense
    const consumed = this.consumeApproval(approvalId, validation.approval.version);

    if (!consumed) {
      return {
        valid: false,
        reason: 'Approval was consumed by a concurrent request (race condition blocked)',
        approval: validation.approval,
      };
    }

    return {
      valid: true,
      reason: 'Approval validated and consumed',
      approval: {
        ...validation.approval,
        status: ApprovalStatus.CONSUMED,
        consumedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Invalidate an approval (e.g., when evidence changes).
   */
  invalidateApproval(approvalId: string): boolean {
    return this.db.invalidateApproval(approvalId);
  }

  private rowToApproval(row: any): ApprovalRecord {
    return {
      approvalId: row.approval_id,
      caseId: row.case_id,
      merchantId: row.merchant_id,
      actionType: row.action_type as ActionType,
      targetCaptureId: row.target_capture_id,
      targetOrderId: row.target_order_id,
      exactAmount: row.exact_amount,
      currency: row.currency,
      actionArgsDigest: row.action_args_digest,
      claimDigest: row.claim_digest,
      evidenceDigest: row.evidence_digest,
      policyVersion: row.policy_version,
      status: row.status as ApprovalStatus,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      approvedBy: row.approved_by,
      version: row.version,
    };
  }
}
