import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Surety } from '../src/core/surety';
import { PremiseVerificationEngine } from '../src/core/verification-engine';
import { SuretyDatabase } from '../src/db/database';
import { ExecutionStore } from '../src/db/execution-store';
import { SimulationProvider, demoScenarios, scenarioRecord } from '../src/providers/simulation';
import { ActionType, ClaimType } from '../src/core/types';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'surety-claims-'));
  const records = demoScenarios.map(scenarioRecord);
  const provider = new SimulationProvider(records);
  const database = new SuretyDatabase(join(directory, 'test.db'));
  const store = new ExecutionStore(join(directory, 'test.db'));
  const service = new Surety(store, database, provider);
  return {
    provider,
    service,
    close() {
      store.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function createCase(service: Surety, scenarioId: string) {
  const scenario = demoScenarios.find((s) => s.id === scenarioId)!;
  const record = scenarioRecord(scenario);
  return service.create(
    {
      actionType: ActionType.REFUND,
      captureId: record.captureId,
      orderId: record.orderId,
      merchantId: record.merchantId,
      customerId: record.customerId,
      amount: scenario.amount,
      currency: 'USD',
      reason: `Fixture ${scenarioId}`,
    },
    {
      claimType: scenario.claimType,
      orderReference: record.orderId,
      captureReference: record.captureId,
      merchantId: record.merchantId,
      customerId: record.customerId,
      rawStatement: scenario.statement,
      extractedAmount: scenario.amount,
      extractedCurrency: 'USD',
      confidence: 0,
    },
  );
}

it('duplicate charge with two captures verifies and auto-executes', async () => {
  const s = setup();
  try {
    const c = await createCase(s.service, 'duplicate');
    expect(c.verification.verdict).toBe('VERIFIED');
    expect(c.verification.reasonCodes).toContain('DUPLICATE_CAPTURE_CONFIRMED');
    expect(c.decision).toBe('EXECUTE');
    const executed = await s.service.execute(c.caseId);
    expect(executed.executionState).toBe('SUCCEEDED');
  } finally {
    s.close();
  }
});

it('duplicate claim with a single capture is contradicted', async () => {
  const s = setup();
  try {
    const c = await createCase(s.service, 'duplicate-single');
    expect(c.verification.verdict).toBe('CONTRADICTED');
    expect(c.verification.reasonCodes).toContain('SINGLE_CAPTURE_ONLY');
    expect(c.decision).toBe('DENY');
  } finally {
    s.close();
  }
});

it('already-refunded claim with prior refund is contradicted', async () => {
  const s = setup();
  try {
    const c = await createCase(s.service, 'refunded');
    expect(c.verification.verdict).toBe('CONTRADICTED');
    expect(c.verification.reasonCodes).toContain('PRIOR_REFUND_CONFIRMED');
    expect(c.decision).toBe('DENY');
  } finally {
    s.close();
  }
});

it('wrong-amount claim with capture above order routes to review with evidence', async () => {
  const s = setup();
  try {
    const c = await createCase(s.service, 'wrong-amount');
    expect(c.verification.verdict).toBe('UNKNOWN');
    expect(c.verification.reasonCodes).toContain('AMOUNT_DISCREPANCY_CONFIRMED');
    expect(c.decision).toBe('REVIEW');
    // A reviewer can still approve the exact action.
    s.service.approve(c.caseId, 'reviewer');
    const executed = await s.service.execute(c.caseId);
    expect(executed.executionState).toBe('SUCCEEDED');
  } finally {
    s.close();
  }
});

it('regression: original four scenarios still behave', async () => {
  const s = setup();
  try {
    const delivered = await createCase(s.service, 'delivered');
    expect(delivered.decision).toBe('DENY');
    const lost = await createCase(s.service, 'lost');
    expect(lost.decision).toBe('EXECUTE');
    const damaged = await createCase(s.service, 'damaged');
    expect(damaged.decision).toBe('REVIEW');
    const processing = await createCase(s.service, 'processing');
    expect(processing.decision).toBe('REVIEW');
  } finally {
    s.close();
  }
});

it('duplicate refund already issued routes to review, never auto-pay', async () => {
  const s = setup();
  try {
    // Build a duplicate scenario where a refund of the same amount already exists.
    const scenario = demoScenarios.find((x) => x.id === 'duplicate')!;
    const record = scenarioRecord(scenario);
    const facts = await s.provider.facts({
      actionType: ActionType.REFUND,
      captureId: record.captureId,
      orderId: record.orderId,
      merchantId: record.merchantId,
      customerId: record.customerId,
      amount: scenario.amount,
      currency: 'USD',
      reason: 'test',
    });
    const withPriorRefund = facts.evidence.map((e) =>
      e.recordType === 'transactions'
        ? {
            ...e,
            data: {
              ...e.data,
              transactions: [
                ...(e.data as { transactions: unknown[] }).transactions,
                {
                  kind: 'REFUND',
                  transactionId: 'SIM-REFUND-PRIOR',
                  eventCode: 'T0008',
                  status: 'S',
                  amount: '49.00',
                  currency: 'USD',
                  initiatedAt: new Date().toISOString(),
                  payerEmail: 'sim-customer@example.com',
                },
              ],
            },
          }
        : e,
    );
    const verdict = new PremiseVerificationEngine().verify(
      {
        claimType: ClaimType.DUPLICATE_CHARGE,
        orderReference: record.orderId,
        captureReference: record.captureId,
        merchantId: record.merchantId,
        customerId: record.customerId,
        rawStatement: 'charged twice',
        extractedAmount: 49,
        extractedCurrency: 'USD',
        confidence: 0,
      },
      {
        actionType: ActionType.REFUND,
        captureId: record.captureId,
        orderId: record.orderId,
        merchantId: record.merchantId,
        customerId: record.customerId,
        amount: 49,
        currency: 'USD',
        reason: 'test',
      },
      withPriorRefund,
    );
    expect(verdict.decision).toBe('REVIEW');
    expect(verdict.reasonCodes).toContain('DUPLICATE_ALREADY_REFUNDED');
  } finally {
    s.close();
  }
});
