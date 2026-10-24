import { it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server';

it('hosted mode requires session auth and enforces reviewer role for approvals', async () => {
  const previousHost = process.env.HOST;
  const directory = mkdtempSync(join(tmpdir(), 'surety-auth-'));
  process.env.HOST = '0.0.0.0';
  let runtime: ReturnType<typeof createApplication>;
  try {
    runtime = createApplication(join(directory, 'test.db'));
  } finally {
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
  }
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    const config = (await (await fetch(base + '/api/config')).json()) as { csrf: string };
    const csrf = { 'X-Surety-CSRF': config.csrf };

    // Unauthenticated API write is rejected.
    expect((await post('/api/cases', {}, csrf)).status).toBe(401);

    // Wrong password is rejected.
    expect(
      (await post('/api/auth/login', { role: 'operator', password: 'wrong' }, csrf)).status,
    ).toBe(401);

    // Operator signs in and can create a case.
    const login = await post(
      '/api/auth/login',
      { role: 'operator', password: 'operator-demo' },
      csrf,
    );
    expect(login.status).toBe(200);
    const operatorCookie = login.headers.getSetCookie()[0].split(';')[0];
    expect(
      await (
        await fetch(base + '/api/auth/session', { headers: { Cookie: operatorCookie } })
      ).json(),
    ).toEqual(expect.objectContaining({ role: 'operator' }));

    const review = await post(
      '/api/cases',
      {
        orderId: 'SIM-ORD-damaged',
        statement: 'The item arrived damaged. Please refund $49.',
        amount: 49,
        scenario: 'damaged',
        useAI: false,
      },
      { ...csrf, Cookie: operatorCookie },
    );
    expect(review.status).toBe(201);
    const caseId = ((await review.json()) as { caseId: string }).caseId;

    // Operator cannot approve; reviewer can.
    expect(
      (await post(`/api/cases/${caseId}/approve`, {}, { ...csrf, Cookie: operatorCookie })).status,
    ).toBe(403);
    const reviewerLogin = await post(
      '/api/auth/login',
      { role: 'reviewer', password: 'reviewer-demo' },
      csrf,
    );
    const reviewerCookie = reviewerLogin.headers.getSetCookie()[0].split(';')[0];
    expect(
      (await post(`/api/cases/${caseId}/approve`, {}, { ...csrf, Cookie: reviewerCookie })).status,
    ).toBe(200);

    // Logout invalidates the session client-side.
    expect(
      (
        await post('/api/auth/logout', {}, { ...csrf, Cookie: reviewerCookie })
      ).headers.getSetCookie()[0],
    ).toContain('Max-Age=0');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
