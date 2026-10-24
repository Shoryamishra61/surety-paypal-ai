// ============================================================
// SURETY — PayPal webhook intake.
//
// Signature verification uses PayPal's verify-webhook-signature
// API when PAYPAL_WEBHOOK_ID is configured (fail-closed: invalid
// signatures are rejected). Without a webhook ID the event is
// accepted and labeled UNVERIFIED — safe only because webhook
// events are hints: reconciliation re-reads authoritative refund
// state through the API before any state transition, so a forged
// event can at most trigger a read.
// ============================================================

import { z } from 'zod';

export interface WebhookHeaders {
  'paypal-transmission-id'?: string;
  'paypal-transmission-time'?: string;
  'paypal-cert-url'?: string;
  'paypal-auth-algo'?: string;
  'paypal-transmission-sig'?: string;
}

const eventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z
    .object({
      id: z.string().optional(),
      event_version: z.string().optional(),
      resource_type: z.string().optional(),
    })
    .passthrough()
    .optional(),
  create_time: z.string().optional(),
});

export type WebhookVerification = 'SIGNATURE_VERIFIED' | 'UNVERIFIED_ACCEPTED';

export interface AcceptedWebhook {
  eventId: string;
  eventType: string;
  resourceId: string | null;
  resourceType: string | null;
  receivedAt: string;
  verification: WebhookVerification;
  raw: string;
}

/** Refund resource IDs arrive as the refund object's id. */
const REFUND_EVENT_PREFIX = 'PAYMENT.CAPTURE.REFUND';
const REFUND_COMPLETED_TYPES = new Set(['PAYMENT.CAPTURE.REFUNDED']);

export function isRefundEvent(eventType: string): boolean {
  return eventType.startsWith(REFUND_EVENT_PREFIX) || REFUND_COMPLETED_TYPES.has(eventType);
}

export async function verifyWebhookSignature(input: {
  webhookId: string;
  headers: WebhookHeaders;
  rawBody: string;
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  request?: typeof fetch;
}): Promise<boolean> {
  const request = input.request ?? fetch;
  const auth = await request(
    `${input.apiBase ?? 'https://api-m.sandbox.paypal.com'}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!auth.ok) return false;
  const token = z.object({ access_token: z.string() }).parse(await auth.json()).access_token;
  const response = await request(
    `${input.apiBase ?? 'https://api-m.sandbox.paypal.com'}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: input.headers['paypal-auth-algo'],
        cert_url: input.headers['paypal-cert-url'],
        transmission_id: input.headers['paypal-transmission-id'],
        transmission_sig: input.headers['paypal-transmission-sig'],
        transmission_time: input.headers['paypal-transmission-time'],
        webhook_id: input.webhookId,
        webhook_event: JSON.parse(input.rawBody),
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) return false;
  const result = z.object({ verification_status: z.string() }).parse(await response.json());
  return result.verification_status === 'SUCCESS';
}

/** Parse + validate an incoming webhook body; throws on malformed input. */
export function parseWebhookEvent(rawBody: string): AcceptedWebhook {
  const parsed = eventSchema.parse(JSON.parse(rawBody));
  return {
    eventId: parsed.id,
    eventType: parsed.event_type,
    resourceId: parsed.resource?.id ?? null,
    resourceType: parsed.resource?.resource_type ?? null,
    receivedAt: new Date().toISOString(),
    verification: 'UNVERIFIED_ACCEPTED',
    raw: rawBody,
  };
}
