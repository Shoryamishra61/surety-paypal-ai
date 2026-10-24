// ============================================================
// SURETY — Core Type Definitions
// Premise-Bound Execution for PayPal Agents
// ============================================================

import { z } from 'zod';

// ── Claim Types ──────────────────────────────────────────────
export enum ClaimType {
  NOT_DELIVERED = 'NOT_DELIVERED',
  DUPLICATE_CHARGE = 'DUPLICATE_CHARGE',
  ALREADY_REFUNDED = 'ALREADY_REFUNDED',
  WRONG_AMOUNT = 'WRONG_AMOUNT',
  CANCELLATION_REFUND = 'CANCELLATION_REFUND',
  DAMAGED_ITEM = 'DAMAGED_ITEM',
  NOT_AS_DESCRIBED = 'NOT_AS_DESCRIBED',
  OTHER = 'OTHER',
}

// ── Verification Verdicts ────────────────────────────────────
export enum PremiseVerdict {
  /** Factual premise is supported by authoritative records */
  VERIFIED = 'VERIFIED',
  /** Factual premise is contradicted by authoritative records */
  CONTRADICTED = 'CONTRADICTED',
  /** Evidence is insufficient, subjective, or unresolvable */
  UNKNOWN = 'UNKNOWN',
}

// ── Execution Decisions ──────────────────────────────────────
export enum ExecutionDecision {
  /** Premise verified + policy permits → execute the financial action */
  EXECUTE = 'EXECUTE',
  /** Premise contradicted → block the financial action */
  DENY = 'DENY',
  /** Premise unknown/subjective → require human review */
  REVIEW = 'REVIEW',
}

// ── Shipment / Fulfillment States ────────────────────────────
export enum FulfillmentStatus {
  DELIVERED = 'DELIVERED',
  LOST = 'LOST',
  PROCESSING = 'PROCESSING',
  IN_TRANSIT = 'IN_TRANSIT',
  RETURNED = 'RETURNED',
  CANCELLED = 'CANCELLED',
  UNKNOWN = 'UNKNOWN',
}

// ── Financial Action Types ───────────────────────────────────
export enum ActionType {
  REFUND = 'REFUND',
  PARTIAL_REFUND = 'PARTIAL_REFUND',
}

// ── Approval States ──────────────────────────────────────────
export enum ApprovalStatus {
  PENDING = 'PENDING',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
  REJECTED = 'REJECTED',
  INVALIDATED = 'INVALIDATED',
}

// ── Case/Execution States ────────────────────────────────────
export enum CaseStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  VERIFIED = 'VERIFIED',
  CONTRADICTED = 'CONTRADICTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  EXECUTED = 'EXECUTED',
  DENIED = 'DENIED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

// ── Evidence Source Provenance ────────────────────────────────
export enum EvidenceProvider {
  PAYPAL = 'PAYPAL',
  MERCHANT_OMS = 'MERCHANT_OMS',
  CARRIER = 'CARRIER',
  CUSTOMER_REPORTED = 'CUSTOMER_REPORTED',
}

// ── System Mode ──────────────────────────────────────────────
export enum SystemMode {
  LIVE = 'LIVE',
  SIMULATION = 'SIMULATION',
  DEMO_REPLAY = 'DEMO_REPLAY',
}

// ============================================================
// Structured Data Interfaces
// ============================================================

/** Extracted typed claim from customer language */
export interface TypedClaim {
  claimType: ClaimType;
  orderReference: string | null;
  captureReference: string | null;
  customerId: string | null;
  merchantId: string;
  rawStatement: string;
  extractedAmount: number | null;
  extractedCurrency: string | null;
  confidence: number; // Model confidence — NOT used for financial decisions
}

/** A proposed financial action */
export interface ProposedAction {
  actionType: ActionType;
  captureId: string;
  orderId: string;
  amount: number;
  currency: string;
  merchantId: string;
  customerId: string;
  reason: string;
}

/** Evidence record from an authoritative source */
export interface EvidenceRecord {
  evidenceId: string;
  provider: EvidenceProvider;
  providerId: string; // The ID from the provider's system
  parentId: string | null; // Parent record ID (e.g., order for a capture)
  recordType: string; // 'order' | 'capture' | 'shipment' | 'refund' | 'dispute'
  state: string; // Provider-specific state
  timestamp: string; // ISO 8601
  data: Record<string, unknown>;
  provenance: string; // Human-readable provenance description
}

/** Transaction relationship graph node */
export interface RelationshipNode {
  id: string;
  type: 'merchant' | 'customer' | 'order' | 'capture' | 'refund' | 'shipment' | 'dispute';
  provider: EvidenceProvider;
  providerId: string;
  parentId: string | null;
  state: string;
  metadata: Record<string, unknown>;
}

/** Relationship binding result */
export interface RelationshipBindingResult {
  valid: boolean;
  graph: RelationshipNode[];
  errors: RelationshipError[];
  warnings: string[];
}

export interface RelationshipError {
  code: string;
  message: string;
  expectedId: string;
  actualId: string;
  relationship: string;
}

/** Verification result from the premise engine */
export interface VerificationResult {
  verdict: PremiseVerdict;
  decision: ExecutionDecision;
  reasonCodes: string[];
  evidenceUsed: EvidenceRecord[];
  unresolvedFacts: string[];
  relationshipBinding: RelationshipBindingResult;
  claimType: ClaimType;
  policyVersion: string;
}

/** Policy evaluation result */
export interface PolicyResult {
  permitted: boolean;
  requiresApproval: boolean;
  reasonCodes: string[];
  maxAutonomousAmount: number;
  remainingRefundable: number;
  policyVersion: string;
  violations: string[];
}

/** Human approval record — security primitive */
export interface ApprovalRecord {
  approvalId: string;
  caseId: string;
  merchantId: string;
  actionType: ActionType;
  targetCaptureId: string;
  targetOrderId: string;
  exactAmount: number;
  currency: string;
  actionArgsDigest: string;
  claimDigest: string;
  evidenceDigest: string;
  policyVersion: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  approvedBy: string | null;
  version: number; // Optimistic concurrency
}

/** FactPack — the core audit/decision artifact */
export interface FactPack {
  factPackId: string;
  caseId: string;
  version: number;
  merchantId: string;
  agentId: string | null;
  customerId: string;

  // Source
  rawCustomerStatement: string;
  extractedClaim: TypedClaim;
  claimSchemaVersion: string;

  // Proposed action
  proposedAction: ProposedAction;

  // PayPal identifiers
  captureId: string;
  orderId: string;
  transactionId: string | null;
  disputeId: string | null;

  // Evidence
  evidenceSources: EvidenceRecord[];
  relationshipGraph: RelationshipNode[];
  evidenceTimestamp: string;
  evidenceDigest: string;

  // Verification
  verificationResult: VerificationResult;
  policyResult: PolicyResult;
  policyVersion: string;

  // Approval
  approvalId: string | null;
  approvalStatus: ApprovalStatus | null;

  // Execution
  executionDecision: ExecutionDecision;
  paypalRequestId: string | null;
  paypalResponseId: string | null;
  paypalRefundId: string | null;
  executionState: CaseStatus;

  // Audit
  systemMode: SystemMode;
  createdAt: string;
  updatedAt: string;
  previousVersion: number | null;
}

// ============================================================
// Zod Schemas for Runtime Validation
// ============================================================

export const TypedClaimSchema = z.object({
  claimType: z.nativeEnum(ClaimType),
  orderReference: z.string().nullable(),
  captureReference: z.string().nullable(),
  customerId: z.string().nullable(),
  merchantId: z.string(),
  rawStatement: z.string(),
  extractedAmount: z.number().nullable(),
  extractedCurrency: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const ProposedActionSchema = z.object({
  actionType: z.nativeEnum(ActionType),
  captureId: z.string().min(1),
  orderId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  reason: z.string(),
});

/** Schema for validating LLM claim extraction output */
export const LLMClaimExtractionSchema = z.object({
  claimType: z.nativeEnum(ClaimType),
  orderReference: z.string().nullable().optional(),
  captureReference: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  rawStatement: z.string(),
  extractedAmount: z.number().nullable().optional(),
  extractedCurrency: z.string().nullable().optional(),
  reasoning: z.string().optional(),
});

export type LLMClaimExtraction = z.infer<typeof LLMClaimExtractionSchema>;
