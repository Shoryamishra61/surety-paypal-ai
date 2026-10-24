// ============================================================
// SURETY — SQLite compatibility layer over Node's built-in
// node:sqlite (DatabaseSync). Provides the small subset of the
// better-sqlite3 API this codebase uses, so persistence code
// stays synchronous and transactional with zero native deps.
//
// Supported: prepare().get/all/run, exec, pragma, transaction()
// with deferred and immediate variants, close.
// ============================================================

import { DatabaseSync } from 'node:sqlite';

export interface StatementResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): StatementResult;
}

export type TransactionFunction<T> = (() => T) & { immediate(): T };

export interface SqliteDatabase {
  /** Filename the database was opened with. */
  readonly name: string;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(assignment: string): void;
  transaction<T>(fn: () => T): TransactionFunction<T>;
  close(): void;
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function openDatabase(filename: string): SqliteDatabase {
  const db = new DatabaseSync(filename);
  // Match better-sqlite3's default busy timeout so concurrent writers
  // wait briefly instead of failing immediately with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000');
  const statement = (sql: string): SqliteStatement => {
    const prepared = db.prepare(sql);
    return {
      get: (...params) => prepared.get(...(params as [])) as unknown,
      all: (...params) => prepared.all(...(params as [])) as unknown[],
      run: (...params) => {
        const result = prepared.run(...(params as []));
        return {
          changes: toNumber(result.changes),
          lastInsertRowid: toNumber(result.lastInsertRowid),
        };
      },
    };
  };
  const runInTransaction = <T>(fn: () => T, mode: 'DEFERRED' | 'IMMEDIATE'): T => {
    db.exec(`BEGIN ${mode}`);
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const database: SqliteDatabase = {
    name: filename,
    exec: (sql) => void db.exec(sql),
    prepare: statement,
    pragma: (assignment) => void db.exec(`PRAGMA ${assignment}`),
    transaction: <T>(fn: () => T): TransactionFunction<T> => {
      const deferred = () => runInTransaction(fn, 'DEFERRED');
      return Object.assign(deferred, { immediate: () => runInTransaction(fn, 'IMMEDIATE') });
    },
    close: () => db.close(),
  };
  return database;
}
