// ============================================================
// SURETY — PayPal Agent Toolkit (read path).
//
// Evidence-grade reads flow through PayPal's official
// @paypal/agent-toolkit: orders, shipment tracking, refunds,
// transactions, disputes. Only read actions are enabled here.
// Payment writes never go through the toolkit for agents; the
// single write path is Surety's hardened REST adapter with
// explicit idempotency and fail-closed reconciliation, invoked
// only after adjudication. That separation IS the product.
// ============================================================

import { z } from 'zod';
import type { EvidenceRecord, FulfillmentStatus } from '../core/types';
import { EvidenceProvider, FulfillmentStatus as Fulfillment } from '../core/types';

export interface ToolkitRunner {
  run(method: string, arg: unknown): Promise<unknown>;
}

/** Wraps the official toolkit; tools are addressed by their stable method names. */
export class AgentToolkitRunner implements ToolkitRunner {
  private methods: Map<string, { invoke(arg: unknown): Promise<unknown> }>;
  private constructor(
    methods: Map<string, { invoke(arg: unknown): Promise<unknown> }>,
    readonly sandbox: boolean,
  ) {
    this.methods = methods;
  }
  static async create(
    clientId: string,
    clientSecret: string,
    sandbox: boolean,
  ): Promise<AgentToolkitRunner> {
    const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/langchain');
    const toolkit = new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: {
        actions: {
          orders: { get: true },
          payments: { getRefunds: true },
          shipment: { get: true },
          transactions: { list: true },
          disputes: { list: true, get: true },
        },
        context: { sandbox },
      },
    });
    const methods = new Map<string, { invoke(arg: unknown): Promise<unknown> }>();
    for (const tool of toolkit.tools) methods.set(tool.method, tool);
    return new AgentToolkitRunner(methods, sandbox);
  }
  async run(method: string, arg: unknown): Promise<unknown> {
    const tool = this.methods.get(method);
    if (!tool) throw new Error(`PayPal Agent Toolkit method ${method} is not enabled`);
    return tool.invoke(arg);
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── PayPal response contracts ────────────────────────────────

const trackerSchema = z.object({
  transaction_id: z.string().optional(),
  tracking_number: z.string().nullable().optional(),
  status: z.string(),
  status_update_time: z.string().datetime().optional(),
  last_updated_time: z.string().datetime().optional(),
  carrier: z.object({ name: z.string().optional() }).optional(),
});
const trackersResponseSchema = z.object({ trackers: z.array(trackerSchema) });
const refundResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.object({ value: z.string(), currency_code: z.string() }).optional(),
  update_time: z.string().datetime().optional(),
});

/** PayPal tracking status → Surety fulfillment state. Unmapped states stay UNKNOWN. */
const TRACKING_STATUS: Record<string, FulfillmentStatus> = {
  DELIVERED: Fulfillment.DELIVERED,
  DELIVERED_TO_PICKUP: Fulfillment.DELIVERED,
  SHIPPED: Fulfillment.IN_TRANSIT,
  ON_HOLD: Fulfillment.PROCESSING,
  CANCELLED: Fulfillment.CANCELLED,
};

export interface TrackingEvidence {
  transactionId: string | null;
  trackingNumber: string | null;
  status: FulfillmentStatus;
  rawStatus: string;
  observedAt: string;
  carrier: string | null;
}

export class PayPalToolkitReader {
  constructor(
    private runner: ToolkitRunner,
    private timeoutMs = 15_000,
  ) {}

  private async call(method: string, arg: unknown): Promise<unknown> {
    return withTimeout(this.runner.run(method, arg), this.timeoutMs, `PayPal ${method}`);
  }

  /**
   * Shipment tracking recorded inside PayPal for a capture's transaction.
   * Returns null when this order simply has no tracking; a lookup
   * infrastructure failure throws so adjudication can fail closed.
   */
  async trackingForCapture(orderId: string, captureId: string): Promise<TrackingEvidence | null> {
    let response: unknown;
    try {
      response = await this.call('get_shipment_tracking', {
        order_id: orderId,
        transaction_id: captureId,
      });
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (/404|not found|no tracking|resource_not_found/i.test(message)) return null;
      throw error;
    }
    const parsed = trackersResponseSchema.parse(parseMaybeJson(response));
    const tracker = parsed.trackers.find(
      (t) => !t.transaction_id || t.transaction_id === captureId,
    );
    if (!tracker) return null;
    return {
      transactionId: tracker.transaction_id ?? null,
      trackingNumber: tracker.tracking_number ?? null,
      status: TRACKING_STATUS[tracker.status] ?? 'UNKNOWN',
      rawStatus: tracker.status,
      observedAt:
        tracker.status_update_time ?? tracker.last_updated_time ?? new Date().toISOString(),
      carrier: tracker.carrier?.name ?? null,
    };
  }

  /** Tracking evidence record with honest provenance: merchant-reported via PayPal's tracking system. */
  trackingEvidence(orderId: string, captureId: string, tracking: TrackingEvidence): EvidenceRecord {
    return {
      evidenceId: `pp-tracking:${captureId}`,
      provider: EvidenceProvider.MERCHANT_OMS,
      providerId: tracking.trackingNumber ?? captureId,
      parentId: orderId,
      recordType: 'shipment',
      state: tracking.status,
      timestamp: tracking.observedAt,
      data: {
        source: 'paypal-tracking',
        rawStatus: tracking.rawStatus,
        carrier: tracking.carrier,
        transactionId: tracking.transactionId,
      },
      provenance: `PayPal shipment tracking via official Agent Toolkit (status ${tracking.rawStatus})`,
    };
  }

  async refund(refundId: string): Promise<{
    id: string;
    status: string;
    amountMinor: number | null;
    currency: string | null;
    updatedAt: string | null;
  }> {
    const parsed = refundResponseSchema.parse(
      parseMaybeJson(await this.call('get_refund', { refund_id: refundId })),
    );
    if (parsed.id !== refundId) throw new Error('Toolkit refund response ID mismatch');
    return {
      id: parsed.id,
      status: parsed.status,
      amountMinor: parsed.amount ? Math.round(Number(parsed.amount.value) * 100) : null,
      currency: parsed.amount?.currency_code ?? null,
      updatedAt: parsed.update_time ?? null,
    };
  }
}
