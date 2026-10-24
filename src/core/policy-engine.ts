// ============================================================
// SURETY — Policy Engine
// Runs AFTER premise verification, not instead of it.
// Enforces per-currency financial limits, approval requirements,
// and remaining refundable amount validation in exact minor
// units.
// ============================================================

import {
  ActionType,
  ExecutionDecision,
  PolicyResult,
  ProposedAction,
  VerificationResult,
  PremiseVerdict,
} from './types';
import { minorExponent, toMinor } from './money';

/** Caps and daily limits are set per currency by the merchant. */
export interface CurrencyPolicy {
  currency: string;
  /** Maximum amount an agent can refund autonomously per transaction */
  maxAutonomousRefundAmount: number;
  /** Maximum refund amount per customer per day in this currency */
  customerDailyLimit: number;
  /** Maximum refund amount per merchant per day in this currency */
  merchantDailyLimit: number;
}

export interface PolicyConfig {
  /** One entry per currency the merchant accepts agent refunds in */
  currencies: CurrencyPolicy[];
  /** Whether human approval is always required regardless of verification */
  alwaysRequireApproval: boolean;
  /** Allowed action types */
  allowedActionTypes: ActionType[];
  /** Policy version identifier */
  version: string;
}

export const DEFAULT_POLICY: PolicyConfig = {
  currencies: [
    {
      currency: 'USD',
      maxAutonomousRefundAmount: 50,
      customerDailyLimit: 200,
      merchantDailyLimit: 5000,
    },
    {
      currency: 'EUR',
      maxAutonomousRefundAmount: 50,
      customerDailyLimit: 200,
      merchantDailyLimit: 5000,
    },
    {
      currency: 'GBP',
      maxAutonomousRefundAmount: 40,
      customerDailyLimit: 150,
      merchantDailyLimit: 4000,
    },
    {
      currency: 'JPY',
      maxAutonomousRefundAmount: 7500,
      customerDailyLimit: 30000,
      merchantDailyLimit: 700000,
    },
  ],
  alwaysRequireApproval: false,
  allowedActionTypes: [ActionType.REFUND, ActionType.PARTIAL_REFUND],
  version: '2.0.0',
};

/** Financial history in exact minor units of one currency. */
export interface RefundHistory {
  captureId: string;
  currency: string;
  captureAmountMinor: number;
  totalRefundedMinor: number;
}

/** Daily usage in exact minor units of one currency. */
export interface DailyUsage {
  customerId: string;
  merchantId: string;
  currency: string;
  customerDailyMinor: number;
  merchantDailyMinor: number;
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

  policyFor(currency: string): CurrencyPolicy | undefined {
    return this.config.currencies.find((c) => c.currency === currency);
  }

  /**
   * Evaluate policy constraints against a verified action.
   *
   * @param action - The proposed financial action
   * @param verification - The premise verification result
   * @param refundHistory - Prior refund history for the capture (minor units)
   * @param dailyUsage - Daily usage counters (minor units)
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
    let maxAutonomousAmount = 0;
    const currencyPolicy = this.policyFor(action.currency);

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
      !Number.isSafeInteger(refundHistory.captureAmountMinor) ||
      !Number.isSafeInteger(refundHistory.totalRefundedMinor) ||
      refundHistory.totalRefundedMinor < 0
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

    // ── 2. Currency permitted, amount exact in minor units ───
    let amountMinor = 0;
    if (!currencyPolicy) {
      violations.push(`Currency ${action.currency} is not permitted by policy`);
      reasonCodes.push('CURRENCY_NOT_ALLOWED');
    } else {
      maxAutonomousAmount = currencyPolicy.maxAutonomousRefundAmount;
      try {
        amountMinor = toMinor(action.amount, action.currency);
        if (amountMinor <= 0) throw new Error('non-positive');
      } catch {
        violations.push('Refund amount must be positive and exact to the currency exponent');
        reasonCodes.push('INVALID_AMOUNT');
      }
    }

    // ── 3. Remaining refundable amount ───────────────────────
    if (refundHistory && currencyPolicy) {
      remainingRefundable =
        (refundHistory.captureAmountMinor - refundHistory.totalRefundedMinor) /
        10 ** minorExponent(action.currency);
      if (refundHistory.captureAmountMinor - refundHistory.totalRefundedMinor <= 0) {
        violations.push('Capture has already been fully refunded');
        reasonCodes.push('FULLY_REFUNDED');
      } else if (
        amountMinor >
        refundHistory.captureAmountMinor - refundHistory.totalRefundedMinor
      ) {
        violations.push(
          `Refund amount ${action.amount} exceeds remaining refundable balance ${remainingRefundable}`,
        );
        reasonCodes.push('EXCEEDS_REFUNDABLE_BALANCE');
      }
    }

    // ── 4. Autonomous amount limit ───────────────────────────
    if (
      currencyPolicy &&
      amountMinor > 0 &&
      action.amount > currencyPolicy.maxAutonomousRefundAmount
    ) {
      requiresApproval = true;
      reasonCodes.push('EXCEEDS_AUTONOMOUS_LIMIT');
    }

    // ── 5. Daily limits (per customer and merchant, per currency)
    if (dailyUsage && currencyPolicy) {
      const customerLimitMinor = toMinor(currencyPolicy.customerDailyLimit, action.currency);
      const merchantLimitMinor = toMinor(currencyPolicy.merchantDailyLimit, action.currency);
      if (dailyUsage.customerDailyMinor + amountMinor > customerLimitMinor) {
        requiresApproval = true;
        reasonCodes.push('EXCEEDS_CUSTOMER_DAILY_LIMIT');
      }
      if (dailyUsage.merchantDailyMinor + amountMinor > merchantLimitMinor) {
        requiresApproval = true;
        reasonCodes.push('EXCEEDS_MERCHANT_DAILY_LIMIT');
      }
    }

    // ── 6. Verification-based approval requirement ───────────
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
      maxAutonomousAmount,
      remainingRefundable,
      policyVersion: this.config.version,
      violations,
    };
  }

  /** Get current policy config */
  getConfig(): PolicyConfig {
    return structuredClone(this.config);
  }

  /** Update policy config */
  updateConfig(partial: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
