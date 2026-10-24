// ============================================================
// SURETY — Webhook event store.
//
// PayPal webhook events are durable, deduplicated records. They
// drive the event log and reconciliation hints, but they are
// NEVER authoritative for money state: reconciliation always
// re-reads the refund via the API before changing a reservation.
// ============================================================

import { openDatabase, SqliteDatabase } from './sqlite';

export interface StoredEvent {
  eventId: string;
  eventType: string;
  resourceId: string | null;
  resourceType: string | null;
  verification: 'SIGNATURE_VERIFIED' | 'UNVERIFIED_ACCEPTED' | 'REJECTED';
  receivedAt: string;
  raw: string;
}

export class EventStore {
  readonly db: SqliteDatabase;
  constructor(filename: string) {
    this.db = openDatabase(filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_events(
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        resource_id TEXT,
        resource_type TEXT,
        verification TEXT NOT NULL,
        received_at TEXT NOT NULL,
        raw TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_resource ON webhook_events(resource_id);
    `);
  }
  /** Insert with dedup; returns false when the event was already stored. */
  record(event: StoredEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events VALUES(@eventId,@eventType,@resourceId,@resourceType,@verification,@receivedAt,@raw)`,
      )
      .run(event as unknown as Record<string, unknown>);
    return result.changes === 1;
  }
  list(limit = 100): StoredEvent[] {
    return this.db
      .prepare('SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT ?')
      .all(String(limit)) as unknown as StoredEvent[];
  }
  close(): void {
    this.db.close();
  }
}
