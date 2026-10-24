import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server';
import { isRefundEvent, parseWebhookEvent, verifyWebhookSignature } from '../src/webhooks';
import { EventStore } from '../src/db/event-store';

const refundEvent = {
  id: 'WH-1',
  event_type: 'PAYMENT.CAPTURE.REFUNDED',
  resource: { id: 'REFUND-9', resource_type: 'refund' },
};

it('classifies refund events', () => {
  expect(isRefundEvent('PAYMENT.CAPTURE.REFUNDED')).toBe(true);
  expect(isRefundEvent('PAYMENT.CAPTURE.COMPLETED')).toBe(false);
});

it('parses webhook payloads and rejects malformed ones', () => {
  const parsed = parseWebhookEvent(JSON.stringify(refundEvent));
  expect(parsed).toMatchObject({ eventId: 'WH-1', resourceId: 'REFUND-9' });
  expect(() => parseWebhookEvent('not json')).toThrow();
  expect(() => parseWebhookEvent(JSON.stringify({ no: 'id' }))).toThrow();
});

it('event store deduplicates by event id', () => {
  const directory = mkdtempSync(join(tmpdir(), 'surety-events-'));
  const store = new EventStore(join(directory, 'events.db'));
  try {
    const event = parseWebhookEvent(JSON.stringify(refundEvent));
    expect(store.record(event)).toBe(true);
    expect(store.record(event)).toBe(false);
    expect(store.list()).toHaveLength(1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('signature verification fails closed on provider errors', async () => {
  const request: typeof fetch = async () => new Response('{}', { status: 500 });
  expect(
    await verifyWebhookSignature({
      webhookId: 'WHID',
      headers: {},
      rawBody: JSON.stringify(refundEvent),
      clientId: 'id',
      clientSecret: 'secret',
      request,
    }),
  ).toBe(false);
  const failingStatus: typeof fetch = async () =>
    new Response(JSON.stringify({ verification_status: 'FAILURE' }));
  expect(
    await verifyWebhookSignature({
      webhookId: 'WHID',
      headers: {},
      rawBody: JSON.stringify(refundEvent),
      clientId: 'id',
      clientSecret: 'secret',
      request: async () =>
        // token OK, verification says FAILURE
        new Response(
          JSON.stringify({
            token: true,
            access_token: 't',
            verification_status: 'FAILURE',
          }),
        ),
    }),
  ).toBe(false);
  void failingStatus;
});

it('webhook endpoint stores events, dedupes, and lists them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'surety-webhook-http-'));
  const runtime = createApplication(join(directory, 'test.db'));
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = (await (await fetch(base + '/api/config')).json()) as { csrf: string };
  try {
    const post = () =>
      fetch(base + '/webhooks/paypal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refundEvent),
      });
    const first = await post();
    expect(first.status).toBe(200);
    expect(((await first.json()) as { duplicate: boolean }).duplicate).toBe(false);
    const second = await post();
    expect(((await second.json()) as { duplicate: boolean }).duplicate).toBe(true);
    const malformed = await fetch(base + '/webhooks/paypal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    });
    expect(malformed.status).toBe(400);
    const events = (await (await fetch(base + '/api/events')).json()) as unknown[];
    expect(events).toHaveLength(1);
    void config;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
