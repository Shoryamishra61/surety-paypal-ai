// ============================================================
// SURETY — Policy Engine
// Runs AFTER premise verification, not instead of it.
// Enforces financial limits, approval requirements, and
// remaining refundable amount validation.
// ============================================================

import {
  ActionType,
  ExecutionDecision,
  PolicyResult,
  ProposedAction,
  VerificationResult,
  PremiseVerdict,
} from './types';

export interface PolicyConfig {
  /** Maximum amount an agent can refund autonomously (per transaction) */
  maxAutonomousRefundAmount: number;
  /** Maximum refund amount per customer per day */
  customerDailyLimit: number;
  /** Maximum refund amount per merchant per day */
  merchantDailyLimit: number;
  /** Currency the policy applies to */
  currency: string;
  /** Whether human approval is always required regardless of verification */
  alwaysRequireApproval: boolean;
  /** Allowed action types */
  allowedActionTypes: ActionType[];
  /** Policy version identifier */
  version: string;
}

export const DEFAULT_POLICY: PolicyConfig = {
  maxAutonomousRefundAmount: 50.0,
  customerDailyLimit: 200.0,
  merchantDailyLimit: 5000.0,
  currency: 'USD',
  alwaysRequireApproval: false,
  allowedActionTypes: [ActionType.REFUND, ActionType.PARTIAL_REFUND],
  version: '1.0.0',
};

export interface RefundHistory {
  captureId: string;
  totalRefunded: number;
  captureAmount: number;
  currency: string;
}

export interface DailyUsage {
  customerId: string;
  merchantId: string;
  customerDailyTotal: number;
  merchantDailyTotal: number;
}

/**
 * Deterministic policy engine.
 *
 * INVARIANT: Policy evaluation happens AFTER premise verification.
 * A passing policy check does NOT skip factual verification.
 *
 * Order: bind → verify → policy → execute/review/deny
 */
export class PolicyEngine {
  private config: PolicyConfig;

  constructor(config: PolicyConfig = DEFAULT_POLICY) {
    this.config = config;
  }

  /**
   * Evaluate policy constraints against a verified action.
   *
   * @param action - The proposed financial action
   * @param verification - The premise verification result
   * @param refundHistory - Prior refund history for the capture
   * @param dailyUsage - Daily usage counters
   * @returns Policy evaluation result
   */
  evaluate(
    action: ProposedAction,
    verification: VerificationResult,
    refundHistory: RefundHistory | null,
    dailyUsage: DailyUsage | null,
  ): PolicyResult {
    const violations: string[] = [];
    const reasonCodes: string[] = [];
    let requiresApproval = this.config.alwaysRequireApproval;
    let remainingRefundable = 0;
    if (
      verification.decision === ExecutionDecision.DENY ||
      verification.verdict === PremiseVerdict.CONTRADICTED ||
      !verification.relationshipBinding.valid
    ) {
      violations.push('Premise or relationship validation blocks execution');
      reasonCodes.push('PREMISE_BLOCKED');
    }
    if (
      !refundHistory ||
      refundHistory.captureId !== action.captureId ||
      refundHistory.currency !== action.currency ||
      !Number.isFinite(refundHistory.captureAmount) ||
      !Number.isFinite(refundHistory.totalRefunded) ||
      refundHistory.totalRefunded < 0
    ) {
      violations.push('Missing or invalid financial history');
      reasonCodes.push('INVALID_FINANCIAL_HISTORY');
    }
    if (!dailyUsage) {
      requiresApproval = true;
      reasonCodes.push('DAILY_USAGE_UNKNOWN');
    }

    // ── 1. Action type allowed? ──────────────────────────────
    if (!this.config.allowedActionTypes.includes(action.actionType)) {
      violations.push(`Action type ${action.actionType} is not permitted by policy`);
      reasonCodes.push('ACTION_TYPE_NOT_ALLOWED');
    }

    // ── 2. Currency consistency ──────────────────────────────
    if (action.currency !== this.config.currency) {
      violations.push(
        `Currency mismatch: action is ${action.currency}, policy is ${this.config.currency}`,
      );
      reasonCodes.push('CURRENCY_MISMATCH');
    }

    // ── 3. Amount positive and valid ─────────────────────────
    if (
      !Number.isFinite(action.amount) ||
      action.amount <= 0 ||
      !Number.isSafeInteger(Math.round(action.amount * 100)) ||
      Math.abs(action.amount * 100 - Math.round(action.amount * 100)) > 1e-7
    ) {
      violations.push('Refund amount must be positive');
      reasonCodes.push('INVALID_AMOUNT');
    }

    // ── 4. Remaining refundable amount ───────────────────────
    if (refundHistory) {
      remainingRefundable =
        (Math.round(refundHistory.captureAmount * 100) -
          Math.round(refundHistory.totalRefunded * 100)) /
        100;

      if (remainingRefundable <= 0) {
        violations.push('Capture has already been fully refunded');
        reasonCodes.push('FULLY_REFUNDED');
      } else if (action.amount > remainingRefundable) {
        violations.push(
          `Refund amount ${action.amount} exceeds remaining refundable balance ${remainingRefundable}`,
        );
        reasonCodes.push('EXCEEDS_REFUNDABLE_BALANCE');
      }
    }

    // ── 5. Autonomous amount limit ───────────────────────────
    if (action.amount > this.config.maxAutonomousRefundAmount) {
      requiresApproval = true;
      reasonCodes.push('EXCEEDS_AUTONOMOUS_LIMIT');
    }

    // ── 6. Customer daily limit ──────────────────────────────
    if (dailyUsage) {
      const projectedCustomerDaily = dailyUsage.customerDailyTotal + action.amount;
      if (projectedCustomerDaily > this.config.customerDailyLimit) {
        requiresApproval = true;
        reasonCodes.push('EXCEEDS_CUSTOMER_DAILY_LIMIT');
      }

      // ── 7. Merchant daily limit ────────────────────────────
      const projectedMerchantDaily = dailyUsage.merchantDailyTotal + action.amount;
      if (projectedMerchantDaily > this.config.merchantDailyLimit) {
        requiresApproval = true;
        reasonCodes.push('EXCEEDS_MERCHANT_DAILY_LIMIT');
      }
    }

    // ── 8. Verification-based approval requirement ───────────
    if (verification.decision === ExecutionDecision.REVIEW) {
      requiresApproval = true;
      reasonCodes.push('VERIFICATION_REQUIRES_REVIEW');
    }

    // ── Final decision ───────────────────────────────────────
    const permitted = violations.length === 0;

    return {
      permitted,
      requiresApproval: permitted ? requiresApproval : false,
      reasonCodes,
      maxAutonomousAmount: this.config.maxAutonomousRefundAmount,
      remainingRefundable,
      policyVersion: this.config.version,
      violations,
    };
  }

  /** Get current policy config */
  getConfig(): PolicyConfig {
    return { ...this.config };
  }

  /** Update policy config */
  updateConfig(partial: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
