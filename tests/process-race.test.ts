import { it, expect } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalEngine } from '../src/core/approval-engine';
import { SuretyDatabase } from '../src/db/database';
import { ActionType, ClaimType } from '../src/core/types';
it('two separate processes cannot consume the same durable approval', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'surety-race-'));
  const file = join(directory, 'race.db');
  const db = new SuretyDatabase(file);
  const action = {
    actionType: ActionType.REFUND,
    captureId: 'CAP',
    orderId: 'ORD',
    merchantId: 'M',
    customerId: 'C',
    amount: 1,
    currency: 'USD',
    reason: 'request',
  };
  const claim = {
    claimType: ClaimType.DAMAGED_ITEM,
    orderReference: 'ORD',
    captureReference: 'CAP',
    merchantId: 'M',
    customerId: 'C',
    rawStatement: 'Damaged',
    extractedAmount: 1,
    extractedCurrency: 'USD',
    confidence: 0,
  };
  const approval = new ApprovalEngine(db).createApproval({
    caseId: 'case',
    merchantId: 'M',
    action,
    claim,
    evidence: [],
    policyVersion: 'test-policy',
    approvedBy: 'reviewer',
  });
  const workers = [0, 1].map(() =>
    fork(join(process.cwd(), 'tests/approval-worker.ts'), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
    }),
  );
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve, reject) => {
            worker.once('message', () => resolve());
            worker.once('error', reject);
            worker.once('exit', (code) => {
              if (code) reject(new Error('Approval worker failed'));
            });
          }),
      ),
    );
    const results = workers.map(
      (worker) =>
        new Promise<boolean>((resolve, reject) => {
          worker.once('message', (result: any) => resolve(result.valid));
          worker.once('error', reject);
        }),
    );
    for (const worker of workers)
      worker.send({ file, approvalId: approval.approvalId, action, claim, evidence: [] });
    expect((await Promise.all(results)).filter(Boolean)).toHaveLength(1);
    await Promise.all(
      workers.map((worker) =>
        worker.exitCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) => worker.once('exit', () => resolve())),
      ),
    );
  } finally {
    for (const worker of workers) if (worker.exitCode === null) worker.kill();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
