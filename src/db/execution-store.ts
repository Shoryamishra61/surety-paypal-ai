import { computeDigest } from '../core/digest';
import { openDatabase, SqliteDatabase } from './sqlite';

export type ExecutionState = 'RESERVED' | 'SUCCEEDED' | 'PENDING' | 'FAILED';
export interface CaseRecord {
  caseId: string;
  version: number;
  [key: string]: unknown;
}
export interface Reservation {
  logicalId: string;
  captureId: string;
  merchantId: string;
  customerId: string;
  amountMinor: number;
  argsDigest: string;
  requestId: string;
  state: ExecutionState;
  refundId: string | null;
  approvalId: string | null;
  createdAt: string;
}

/** A reservation survives uncertain provider outcomes. Only verified terminal failure releases it. */
export class ExecutionStore {
  readonly db: SqliteDatabase;
  constructor(filename: string) {
    this.db = openDatabase(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS case_snapshots(case_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(case_id,version));
      CREATE TABLE IF NOT EXISTS reservations(logicalId TEXT PRIMARY KEY, captureId TEXT NOT NULL, merchantId TEXT NOT NULL, customerId TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor>0), argsDigest TEXT NOT NULL, requestId TEXT NOT NULL UNIQUE, state TEXT NOT NULL, refundId TEXT, approvalId TEXT UNIQUE, createdAt TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_per_capture ON reservations(captureId) WHERE state IN ('RESERVED','PENDING');
      CREATE TABLE IF NOT EXISTS case_approvals(case_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL UNIQUE, consumed INTEGER NOT NULL DEFAULT 0);
    `);
  }
  getCase(caseId: string): CaseRecord | undefined {
    const row = this.db
      .prepare('SELECT json FROM case_snapshots WHERE case_id=? ORDER BY version DESC LIMIT 1')
      .get(caseId) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  listCases(): CaseRecord[] {
    return (
      this.db
        .prepare(
          'SELECT json FROM case_snapshots s WHERE version=(SELECT MAX(version) FROM case_snapshots WHERE case_id=s.case_id) ORDER BY rowid DESC LIMIT 100',
        )
        .all() as { json: string }[]
    ).map((r) => JSON.parse(r.json));
  }
  saveCase(record: CaseRecord): void {
    const json = JSON.stringify(record);
    this.db
      .prepare('INSERT INTO case_snapshots VALUES(?,?,?,?)')
      .run(record.caseId, record.version, json, computeDigest(record));
  }
  getReservation(logicalId: string): Reservation | undefined {
    return this.db.prepare('SELECT * FROM reservations WHERE logicalId=?').get(logicalId) as
      Reservation | undefined;
  }
  reserve(
    record: Reservation,
    captureAmountMinor: number,
    refundedMinor: number,
    customerLimitMinor: number,
    merchantLimitMinor: number,
  ): void {
    this.db
      .transaction(() => {
        const sum = (sql: string, ...args: string[]) =>
          Number((this.db.prepare(sql).get(...args) as { n: number }).n);
        const localCapture = sum(
          "SELECT COALESCE(SUM(amountMinor),0) n FROM reservations WHERE captureId=? AND state!='FAILED'",
          record.captureId,
        );
        // Provider totals may already include local successful refunds; max avoids double counting.
        if (record.amountMinor + Math.max(localCapture, refundedMinor) > captureAmountMinor)
          throw new Error('Remaining refundable balance exceeded');
        const day = record.createdAt.slice(0, 10);
        const customer = sum(
          "SELECT COALESCE(SUM(amountMinor),0) n FROM reservations WHERE merchantId=? AND customerId=? AND substr(createdAt,1,10)=? AND state!='FAILED'",
          record.merchantId,
          record.customerId,
          day,
        );
        const merchant = sum(
          "SELECT COALESCE(SUM(amountMinor),0) n FROM reservations WHERE merchantId=? AND substr(createdAt,1,10)=? AND state!='FAILED'",
          record.merchantId,
          day,
        );
        if (
          customer + record.amountMinor > customerLimitMinor ||
          merchant + record.amountMinor > merchantLimitMinor
        )
          throw new Error('Daily limit exceeded');
        if (record.approvalId) {
          const result = this.db
            .prepare(
              'UPDATE case_approvals SET consumed=1 WHERE case_id=? AND approval_id=? AND consumed=0',
            )
            .run(record.logicalId, record.approvalId);
          if (result.changes !== 1)
            throw new Error('Approval already consumed or belongs to another case');
        }
        this.db
          .prepare(
            'INSERT INTO reservations VALUES(@logicalId,@captureId,@merchantId,@customerId,@amountMinor,@argsDigest,@requestId,@state,@refundId,@approvalId,@createdAt)',
          )
          .run(record);
      })
      .immediate();
  }
  finish(logicalId: string, state: ExecutionState, refundId: string | null): void {
    this.db
      .prepare(
        "UPDATE reservations SET state=?,refundId=? WHERE logicalId=? AND state IN ('RESERVED','PENDING')",
      )
      .run(state, refundId, logicalId);
  }
  close(): void {
    this.db.close();
  }
}
