// ============================================================
// SURETY — Digest / Hashing Utilities
// Produces tamper-evident digests for FactPack binding.
// NOT cryptographic immutability — just byte integrity.
// ============================================================

import * as crypto from 'crypto';
import { ProposedAction, TypedClaim, EvidenceRecord } from './types';

/**
 * Create a SHA-256 digest of a canonical JSON representation.
 * Used for binding approvals to exact action arguments,
 * evidence state, and claim content.
 */
export function computeDigest(data: unknown): string {
  const canonical = canonicalize(data);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Canonicalize a value for deterministic hashing.
 * Sorts object keys, handles nested structures.
 */
export function canonicalize(data: unknown): string {
  if (data === null || data === undefined) {
    return 'null';
  }
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return '[' + data.map(canonicalize).join(',') + ']';
  }
  if (typeof data === 'object') {
    const sorted = Object.keys(data as Record<string, unknown>)
      .sort()
      .map((key) => {
        const val = (data as Record<string, unknown>)[key];
        return JSON.stringify(key) + ':' + canonicalize(val);
      });
    return '{' + sorted.join(',') + '}';
  }
  return String(data);
}

/**
 * Compute the action arguments digest for approval binding.
 * This digest must match exactly when consuming an approval.
 */
export function computeActionDigest(action: ProposedAction): string {
  return computeDigest(action);
}

export function computeClaimDigest(claim: TypedClaim): string {
  return computeDigest(claim);
}

export function computeEvidenceDigest(evidence: EvidenceRecord[]): string {
  return computeDigest([...evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
}

/**
 * Generate a unique ID with prefix.
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate a PayPal-compatible idempotency key.
 */
export function generateIdempotencyKey(caseId: string, actionType: string): string {
  return computeDigest({ caseId, actionType }).slice(0, 38);
}
