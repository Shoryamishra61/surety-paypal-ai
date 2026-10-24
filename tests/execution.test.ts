import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Surety } from '../src/core/surety';
import { SuretyDatabase } from '../src/db/database';
import { ExecutionStore } from '../src/db/execution-store';
import { SimulationProvider } from '../src/providers/simulation';
import { ActionType, ClaimType } from '../src/core/types';
const action = {
  actionType: ActionType.REFUND,
  captureId: 'CAP',
  orderId: 'ORD',
  merchantId: 'M',
  customerId: 'C',
  amount: 49,
  currency: 'USD',
  reason: 'Request',
};
const claim = {
  claimType: ClaimType.NOT_DELIVERED,
  orderReference: 'ORD',
  captureReference: 'CAP',
  merchantId: 'M',
  customerId: 'C',
  rawStatement: 'Not delivered',
  extractedAmount: 49,
  extractedCurrency: 'USD',
  confidence: 1,
};
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'surety-'));
  const file = join(path, 'test.db');
  const db = new SuretyDatabase(file);
  const store = new ExecutionStore(file);
  const provider = new SimulationProvider([
    {
      orderId: 'ORD',
      captureId: 'CAP',
      merchantId: 'M',
      customerId: 'C',
      shipmentId: 'SHP',
      fulfillmentState: 'LOST',
      observedAt: new Date().toISOString(),
    },
  ]);
  return {
    service: new Surety(store, db, provider),
    provider,
    store,
    close() {
      store.close();
      db.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
it('simultaneous execution uses one provider call', async () => {
  const s = setup();
  try {
    const c = await s.service.create(action, claim);
    await Promise.all([s.service.execute(c.caseId), s.service.execute(c.caseId)]);
    expect(s.provider.calls).toBe(1);
    expect(s.service.get(c.caseId).executionState).toBe('SUCCEEDED');
    await s.service.execute(c.caseId);
    expect(s.provider.calls).toBe(1);
  } finally {
    s.close();
  }
});
it('two separate cases cannot over-refund one capture', async () => {
  const s = setup();
  try {
    const a = await s.service.create(action, claim);
    const b = await s.service.create(action, claim);
    const result = await Promise.allSettled([
      s.service.execute(a.caseId),
      s.service.execute(b.caseId),
    ]);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(s.provider.calls).toBe(1);
  } finally {
    s.close();
  }
});
it('unknown outcome remains reserved and is not retried', async () => {
  const s = setup();
  try {
    s.provider.refund = async () => {
      s.provider.calls++;
      throw new Error('timeout');
    };
    const c = await s.service.create(action, claim);
    expect((await s.service.execute(c.caseId)).executionState).toBe('PENDING');
    await s.service.execute(c.caseId);
    expect(s.provider.calls).toBe(1);
    expect((await s.service.reconcile(c.caseId)).error).toContain(
      'automatic resubmission is disabled',
    );
  } finally {
    s.close();
  }
});
it('subjective approval binds amount, cannot remint, and executes once', async () => {
  const s = setup();
  try {
    const c = await s.service.create(action, { ...claim, claimType: ClaimType.DAMAGED_ITEM });
    await expect(s.service.execute(c.caseId)).rejects.toThrow('approval');
    const a = s.service.approve(c.caseId, 'reviewer');
    expect(s.service.approve(c.caseId, 'reviewer').approvalId).toBe(a.approvalId);
    await expect(s.service.execute(c.caseId, { ...action, amount: 10 })).rejects.toThrow('differs');
    await Promise.all([s.service.execute(c.caseId), s.service.execute(c.caseId)]);
    expect(s.provider.calls).toBe(1);
  } finally {
    s.close();
  }
});
it('changed evidence invalidates approval', async () => {
  const s = setup();
  try {
    const c = await s.service.create(action, { ...claim, claimType: ClaimType.DAMAGED_ITEM });
    s.service.approve(c.caseId, 'reviewer');
    s.provider.records[0].fulfillmentState = 'PROCESSING';
    await expect(s.service.execute(c.caseId)).rejects.toThrow('Evidence');
    expect(s.provider.calls).toBe(0);
  } finally {
    s.close();
  }
});
it('denied claim never invokes provider refund', async () => {
  const s = setup();
  try {
    s.provider.records[0].fulfillmentState = 'DELIVERED';
    const c = await s.service.create(action, claim);
    await expect(s.service.execute(c.caseId)).rejects.toThrow('Denied');
    expect(s.provider.calls).toBe(0);
  } finally {
    s.close();
  }
});
it('independent SQLite connections enforce one reservation', () => {
  const s = setup();
  const other = new ExecutionStore(s.store.db.name);
  try {
    const reservation = {
      logicalId: 'one',
      captureId: 'CAP',
      currency: 'USD',
      merchantId: 'M',
      customerId: 'C',
      amountMinor: 4900,
      argsDigest: 'digest',
      requestId: 'request1',
      state: 'RESERVED' as const,
      refundId: null,
      approvalId: null,
      createdAt: new Date().toISOString(),
    };
    s.store.reserve(reservation, 4900, 0, 20000, 500000);
    expect(() =>
      other.reserve(
        { ...reservation, logicalId: 'two', requestId: 'request2' },
        4900,
        0,
        20000,
        500000,
      ),
    ).toThrow();
  } finally {
    other.close();
    s.close();
  }
});
