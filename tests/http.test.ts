import { it, expect } from 'vitest';
import { createApplication } from '../src/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('HTTP journey validates CSRF, fixture mode, deny, review, export and execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'surety-http-'));
  const runtime = createApplication(join(directory, 'test.db'));
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const config = (await (await fetch(base + '/api/config')).json()) as { csrf: string };
    expect(
      (
        await fetch(base + '/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const post = async (path: string, body: unknown) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Surety-CSRF': config.csrf },
        body: JSON.stringify(body),
      });
    const denied = (await (
      await post('/api/cases', {
        orderId: 'SIM-ORD-delivered',
        statement: 'My package never arrived. Refund $49.',
        amount: 49,
        scenario: 'delivered',
        useAI: false,
      })
    ).json()) as any;
    expect(denied.decision).toBe('DENY');
    expect((await post(`/api/cases/${denied.caseId}/execute`, {})).status).toBe(400);
    expect(
      (
        await post('/api/cases', {
          orderId: 'SIM-ORD-lost',
          statement: 'Changed text',
          amount: 49,
          scenario: 'lost',
          useAI: false,
        })
      ).status,
    ).toBe(400);
    const review = (await (
      await post('/api/cases', {
        orderId: 'SIM-ORD-damaged',
        statement: 'The item arrived damaged. Please refund $49.',
        amount: 49,
        scenario: 'damaged',
        useAI: false,
      })
    ).json()) as any;
    expect(review.decision).toBe('REVIEW');
    expect((await post(`/api/cases/${review.caseId}/execute`, {})).status).toBe(400);
    expect((await post(`/api/cases/${review.caseId}/approve`, {})).status).toBe(200);
    const executed = (await (
      await post(`/api/cases/${review.caseId}/execute`, { action: review.action })
    ).json()) as any;
    expect(executed.executionState).toBe('SUCCEEDED');
    expect(executed.refundId).toMatch(/^SIM-/);
    const exported = await fetch(base + `/api/cases/${review.caseId}/export`);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    expect(((await exported.json()) as any).evidenceDigest).toHaveLength(64);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
