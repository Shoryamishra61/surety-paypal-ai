// ============================================================
// SURETY — Persistence Layer
// SQLite-backed storage for FactPacks and ApprovalRecords.
// Uses Node's built-in node:sqlite for synchronous, transactional
// operations with zero native dependencies.
//
// SECURITY INVARIANT: Approval state transitions (PENDING→CONSUMED)
// must be atomic. This is enforced via database transactions with
// optimistic concurrency (version column).
// ============================================================

import * as path from 'path';
import { openDatabase, SqliteDatabase } from './sqlite';

export class SuretyDatabase {
  private db: SqliteDatabase;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'surety.db');
    this.db = openDatabase(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  // ── Schema Initialization ──────────────────────────────────
  private initialize(): void {
    this.db.exec(`
      -- FactPack storage: the core audit/decision artifact
      CREATE TABLE IF NOT EXISTS fact_packs (
        fact_pack_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        merchant_id TEXT NOT NULL,
        agent_id TEXT,
        customer_id TEXT NOT NULL,

        -- Source
        raw_customer_statement TEXT NOT NULL,
        extracted_claim_json TEXT NOT NULL,
        claim_schema_version TEXT NOT NULL,

        -- Proposed action
        proposed_action_json TEXT NOT NULL,

        -- PayPal identifiers
        capture_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        transaction_id TEXT,
        dispute_id TEXT,

        -- Evidence
        evidence_sources_json TEXT NOT NULL DEFAULT '[]',
        relationship_graph_json TEXT NOT NULL DEFAULT '[]',
        evidence_timestamp TEXT NOT NULL,
        evidence_digest TEXT NOT NULL,

        -- Verification
        verification_result_json TEXT NOT NULL,
        policy_result_json TEXT NOT NULL,
        policy_version TEXT NOT NULL,

        -- Approval
        approval_id TEXT,
        approval_status TEXT,

        -- Execution
        execution_decision TEXT NOT NULL,
        paypal_request_id TEXT,
        paypal_response_id TEXT,
        paypal_refund_id TEXT,
        execution_state TEXT NOT NULL,

        -- Audit
        system_mode TEXT NOT NULL DEFAULT 'LIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        previous_version INTEGER,

        UNIQUE(case_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_fact_packs_case_id ON fact_packs(case_id);
      CREATE INDEX IF NOT EXISTS idx_fact_packs_merchant ON fact_packs(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_fact_packs_capture ON fact_packs(capture_id);
      CREATE INDEX IF NOT EXISTS idx_fact_packs_order ON fact_packs(order_id);

      -- Approval records: security primitive for human review
      -- CRITICAL: status transitions must be atomic
      CREATE TABLE IF NOT EXISTS approval_records (
        approval_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_capture_id TEXT NOT NULL,
        target_order_id TEXT NOT NULL,
        exact_amount REAL NOT NULL,
        currency TEXT NOT NULL,
        action_args_digest TEXT NOT NULL,
        claim_digest TEXT NOT NULL,
        evidence_digest TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        approved_by TEXT,
        version INTEGER NOT NULL DEFAULT 1,

        CONSTRAINT chk_status CHECK (status IN ('PENDING','CONSUMED','EXPIRED','REJECTED','INVALIDATED'))
      );

      CREATE INDEX IF NOT EXISTS idx_approval_case ON approval_records(case_id);
      CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_records(status);

      -- Execution log: idempotency + reconciliation
      CREATE TABLE IF NOT EXISTS execution_log (
        execution_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        approval_id TEXT,
        action_type TEXT NOT NULL,
        capture_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        paypal_request_id TEXT UNIQUE,
        paypal_response_id TEXT,
        paypal_refund_id TEXT,
        status TEXT NOT NULL DEFAULT 'INITIATED',
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        CONSTRAINT chk_exec_status CHECK (status IN ('INITIATED','EXECUTING','SUCCEEDED','FAILED','DUPLICATE'))
      );

      CREATE INDEX IF NOT EXISTS idx_exec_case ON execution_log(case_id);
      CREATE INDEX IF NOT EXISTS idx_exec_paypal_req ON execution_log(paypal_request_id);

      -- Daily usage tracking for policy enforcement
      CREATE TABLE IF NOT EXISTS daily_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        date TEXT NOT NULL,
        total_refunded REAL NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL,

        UNIQUE(merchant_id, customer_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_merchant ON daily_usage(merchant_id, date);
      CREATE INDEX IF NOT EXISTS idx_daily_customer ON daily_usage(customer_id, date);

      -- Refund history per capture
      CREATE TABLE IF NOT EXISTS refund_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        capture_id TEXT NOT NULL,
        capture_amount REAL NOT NULL,
        total_refunded REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        last_updated TEXT NOT NULL,

        UNIQUE(capture_id)
      );
    `);
  }

  // ============================================================
  // FactPack DAO
  // ============================================================

  saveFactPack(fp: FactPackRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO fact_packs (
        fact_pack_id, case_id, version, merchant_id, agent_id, customer_id,
        raw_customer_statement, extracted_claim_json, claim_schema_version,
        proposed_action_json, capture_id, order_id, transaction_id, dispute_id,
        evidence_sources_json, relationship_graph_json, evidence_timestamp, evidence_digest,
        verification_result_json, policy_result_json, policy_version,
        approval_id, approval_status, execution_decision,
        paypal_request_id, paypal_response_id, paypal_refund_id, execution_state,
        system_mode, created_at, updated_at, previous_version
      ) VALUES (
        @fact_pack_id, @case_id, @version, @merchant_id, @agent_id, @customer_id,
        @raw_customer_statement, @extracted_claim_json, @claim_schema_version,
        @proposed_action_json, @capture_id, @order_id, @transaction_id, @dispute_id,
        @evidence_sources_json, @relationship_graph_json, @evidence_timestamp, @evidence_digest,
        @verification_result_json, @policy_result_json, @policy_version,
        @approval_id, @approval_status, @execution_decision,
        @paypal_request_id, @paypal_response_id, @paypal_refund_id, @execution_state,
        @system_mode, @created_at, @updated_at, @previous_version
      )
    `);
    stmt.run(fp);
  }

  getFactPack(factPackId: string): FactPackRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM fact_packs WHERE fact_pack_id = ?');
    return stmt.get(factPackId) as FactPackRow | undefined;
  }

  getFactPackByCaseId(caseId: string): FactPackRow | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM fact_packs WHERE case_id = ? ORDER BY version DESC LIMIT 1',
    );
    return stmt.get(caseId) as FactPackRow | undefined;
  }

  updateFactPackExecution(
    factPackId: string,
    update: {
      paypal_request_id: string | null;
      paypal_response_id: string | null;
      paypal_refund_id: string | null;
      execution_state: string;
      approval_status: string | null;
      updated_at: string;
    },
  ): boolean {
    const stmt = this.db.prepare(`
      UPDATE fact_packs SET
        paypal_request_id = @paypal_request_id,
        paypal_response_id = @paypal_response_id,
        paypal_refund_id = @paypal_refund_id,
        execution_state = @execution_state,
        approval_status = @approval_status,
        updated_at = @updated_at
      WHERE fact_pack_id = @fact_pack_id
    `);
    const result = stmt.run({ ...update, fact_pack_id: factPackId });
    return result.changes > 0;
  }

  // ============================================================
  // Approval Record DAO
  // ============================================================

  createApproval(record: ApprovalRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO approval_records (
        approval_id, case_id, merchant_id, action_type,
        target_capture_id, target_order_id, exact_amount, currency,
        action_args_digest, claim_digest, evidence_digest, policy_version,
        status, created_at, expires_at, consumed_at, approved_by, version
      ) VALUES (
        @approval_id, @case_id, @merchant_id, @action_type,
        @target_capture_id, @target_order_id, @exact_amount, @currency,
        @action_args_digest, @claim_digest, @evidence_digest, @policy_version,
        @status, @created_at, @expires_at, @consumed_at, @approved_by, @version
      )
    `);
    stmt.run(record);
  }

  getApproval(approvalId: string): ApprovalRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM approval_records WHERE approval_id = ?');
    return stmt.get(approvalId) as ApprovalRow | undefined;
  }

  /**
   * ATOMIC approval consumption.
   *
   * SECURITY INVARIANT: This uses optimistic concurrency control.
   * The UPDATE only succeeds if:
   *   1. The approval exists
   *   2. Status is still PENDING
   *   3. The version matches (no concurrent modification)
   *
   * Returns true if the approval was successfully consumed.
   * Returns false if it was already consumed, expired, or modified.
   *
   * This is the PRIMARY defense against approval replay attacks.
   */
  consumeApproval(approvalId: string, expectedVersion: number, consumedAt: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE approval_records
      SET status = 'CONSUMED',
          consumed_at = @consumed_at,
          version = version + 1
      WHERE approval_id = @approval_id
        AND status = 'PENDING'
        AND version = @expected_version
        AND expires_at > @consumed_at
        AND approved_by IS NOT NULL
    `);

    const result = stmt.run({
      approval_id: approvalId,
      expected_version: expectedVersion,
      consumed_at: consumedAt,
    });

    return result.changes === 1;
  }

  /**
   * Expire all pending approvals that are past their expiry time.
   */
  expirePendingApprovals(now: string): number {
    const stmt = this.db.prepare(`
      UPDATE approval_records
      SET status = 'EXPIRED', version = version + 1
      WHERE status = 'PENDING' AND expires_at < @now
    `);
    const result = stmt.run({ now });
    return result.changes;
  }

  /**
   * Invalidate an approval (e.g., when evidence changes after approval).
   */
  invalidateApproval(approvalId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE approval_records
      SET status = 'INVALIDATED', version = version + 1
      WHERE approval_id = @approval_id AND status = 'PENDING'
    `);
    const result = stmt.run({ approval_id: approvalId });
    return result.changes === 1;
  }

  // ============================================================
  // Execution Log DAO
  // ============================================================

  createExecutionLog(log: ExecutionLogRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO execution_log (
        execution_id, case_id, approval_id, action_type,
        capture_id, amount, currency, paypal_request_id,
        paypal_response_id, paypal_refund_id, status,
        error_message, created_at, updated_at
      ) VALUES (
        @execution_id, @case_id, @approval_id, @action_type,
        @capture_id, @amount, @currency, @paypal_request_id,
        @paypal_response_id, @paypal_refund_id, @status,
        @error_message, @created_at, @updated_at
      )
    `);
    stmt.run(log);
  }

  getExecutionByRequestId(paypalRequestId: string): ExecutionLogRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM execution_log WHERE paypal_request_id = ?');
    return stmt.get(paypalRequestId) as ExecutionLogRow | undefined;
  }

  updateExecutionLog(
    executionId: string,
    update: {
      status: string;
      paypal_response_id: string | null;
      paypal_refund_id: string | null;
      error_message: string | null;
      updated_at: string;
    },
  ): boolean {
    const stmt = this.db.prepare(`
      UPDATE execution_log SET
        status = @status,
        paypal_response_id = @paypal_response_id,
        paypal_refund_id = @paypal_refund_id,
        error_message = @error_message,
        updated_at = @updated_at
      WHERE execution_id = @execution_id
    `);
    const result = stmt.run({ ...update, execution_id: executionId });
    return result.changes > 0;
  }

  // ============================================================
  // Daily Usage DAO
  // ============================================================

  getDailyUsage(merchantId: string, customerId: string, date: string): DailyUsageRow | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM daily_usage WHERE merchant_id = ? AND customer_id = ? AND date = ?',
    );
    return stmt.get(merchantId, customerId, date) as DailyUsageRow | undefined;
  }

  incrementDailyUsage(merchantId: string, customerId: string, date: string, amount: number): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO daily_usage (merchant_id, customer_id, date, total_refunded, last_updated)
      VALUES (@merchant_id, @customer_id, @date, @amount, @now)
      ON CONFLICT(merchant_id, customer_id, date) DO UPDATE SET
        total_refunded = total_refunded + @amount,
        last_updated = @now
    `);
    stmt.run({ merchant_id: merchantId, customer_id: customerId, date, amount, now });
  }

  // ============================================================
  // Refund History DAO
  // ============================================================

  getRefundHistory(captureId: string): RefundHistoryRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM refund_history WHERE capture_id = ?');
    return stmt.get(captureId) as RefundHistoryRow | undefined;
  }

  upsertRefundHistory(
    captureId: string,
    captureAmount: number,
    totalRefunded: number,
    currency: string,
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO refund_history (capture_id, capture_amount, total_refunded, currency, last_updated)
      VALUES (@capture_id, @capture_amount, @total_refunded, @currency, @now)
      ON CONFLICT(capture_id) DO UPDATE SET
        total_refunded = @total_refunded,
        last_updated = @now
    `);
    stmt.run({
      capture_id: captureId,
      capture_amount: captureAmount,
      total_refunded: totalRefunded,
      currency,
      now,
    });
  }

  // ============================================================
  // Transaction helper — for atomic multi-step operations
  // ============================================================

  /**
   * Execute a function inside a SQLite transaction.
   * If the function throws, the transaction is rolled back.
   */
  transaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  close(): void {
    this.db.close();
  }

  /** For testing: wipe all data */
  _dangerouslyResetForTesting(): void {
    this.db.exec(`
      DELETE FROM fact_packs;
      DELETE FROM approval_records;
      DELETE FROM execution_log;
      DELETE FROM daily_usage;
      DELETE FROM refund_history;
    `);
  }
}

// ============================================================
// Row Types — match the SQLite column structure
// ============================================================

export interface FactPackRow {
  fact_pack_id: string;
  case_id: string;
  version: number;
  merchant_id: string;
  agent_id: string | null;
  customer_id: string;
  raw_customer_statement: string;
  extracted_claim_json: string;
  claim_schema_version: string;
  proposed_action_json: string;
  capture_id: string;
  order_id: string;
  transaction_id: string | null;
  dispute_id: string | null;
  evidence_sources_json: string;
  relationship_graph_json: string;
  evidence_timestamp: string;
  evidence_digest: string;
  verification_result_json: string;
  policy_result_json: string;
  policy_version: string;
  approval_id: string | null;
  approval_status: string | null;
  execution_decision: string;
  paypal_request_id: string | null;
  paypal_response_id: string | null;
  paypal_refund_id: string | null;
  execution_state: string;
  system_mode: string;
  created_at: string;
  updated_at: string;
  previous_version: number | null;
}

export interface ApprovalRow {
  approval_id: string;
  case_id: string;
  merchant_id: string;
  action_type: string;
  target_capture_id: string;
  target_order_id: string;
  exact_amount: number;
  currency: string;
  action_args_digest: string;
  claim_digest: string;
  evidence_digest: string;
  policy_version: string;
  status: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  approved_by: string | null;
  version: number;
}

export interface ExecutionLogRow {
  execution_id: string;
  case_id: string;
  approval_id: string | null;
  action_type: string;
  capture_id: string;
  amount: number;
  currency: string;
  paypal_request_id: string | null;
  paypal_response_id: string | null;
  paypal_refund_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyUsageRow {
  id: number;
  merchant_id: string;
  customer_id: string;
  date: string;
  total_refunded: number;
  last_updated: string;
}

export interface RefundHistoryRow {
  id: number;
  capture_id: string;
  capture_amount: number;
  total_refunded: number;
  currency: string;
  last_updated: string;
}
