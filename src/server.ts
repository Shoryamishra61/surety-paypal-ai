import 'dotenv/config';
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Surety } from './core/surety';
import { SuretyDatabase } from './db/database';
import { ExecutionStore } from './db/execution-store';
import { ClaimType, ActionType } from './core/types';
import {
  PayPalSandbox,
  MerchantRecord,
  merchantRecordSchema,
  dollarsToMinor,
} from './providers/paypal';
import { SimulationProvider, demoScenarios, scenarioRecord } from './providers/simulation';
import { AgentToolkitRunner, PayPalToolkitReader } from './providers/paypal-toolkit';
import { EventStore } from './db/event-store';
import { isRefundEvent, parseWebhookEvent, verifyWebhookSignature } from './webhooks';
import type { WebhookHeaders } from './webhooks';
import { ClaimExtractor } from './providers/claim-extractor';
import { createLLMProvider } from './providers/llm-providers';
import {
  Role,
  SessionAuth,
  clearedSessionCookie,
  expectedCredentials,
  parseCookies,
  sessionCookie,
  SESSION_COOKIE,
} from './auth';
import { rateLimit } from './rate-limit';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];

export function createApplication(filename = process.env.DATABASE_PATH || 'surety.db') {
  const mode = process.env.SURETY_MODE || 'SIMULATION';
  if (!['SIMULATION', 'PAYPAL_SANDBOX'].includes(mode))
    throw new Error('Unsupported mode; production execution is disabled');
  const bindHost = process.env.HOST || '127.0.0.1';
  const hosted = !LOOPBACK_HOSTS.includes(bindHost);
  const records: MerchantRecord[] =
    mode === 'SIMULATION'
      ? demoScenarios.map(scenarioRecord)
      : z
          .array(merchantRecordSchema)
          .parse(
            JSON.parse(
              readFileSync(process.env.MERCHANT_RECORDS_PATH || 'merchant-records.json', 'utf8'),
            ),
          );
  if (
    mode === 'PAYPAL_SANDBOX' &&
    (!process.env.OPERATOR_TOKEN ||
      !process.env.REVIEWER_TOKEN ||
      process.env.OPERATOR_TOKEN === process.env.REVIEWER_TOKEN)
  )
    throw new Error('Sandbox requires distinct OPERATOR_TOKEN and REVIEWER_TOKEN');
  const provider =
    mode === 'SIMULATION'
      ? new SimulationProvider(records)
      : new PayPalSandbox(
          process.env.PAYPAL_CLIENT_ID || '',
          process.env.PAYPAL_CLIENT_SECRET || '',
          records,
          fetch,
          // Official Agent Toolkit read path: orders, tracking, refunds,
          // transactions, disputes. Writes stay on the hardened REST adapter.
          async () =>
            new PayPalToolkitReader(
              await AgentToolkitRunner.create(
                process.env.PAYPAL_CLIENT_ID || '',
                process.env.PAYPAL_CLIENT_SECRET || '',
                true,
              ),
            ),
        );
  const database = new SuretyDatabase(filename);
  const store = new ExecutionStore(filename);
  const service = new Surety(store, database, provider);
  const llm = createLLMProvider();
  const extractor = new ClaimExtractor(llm);
  const sessions = new SessionAuth();
  const app = express();
  if (hosted) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '64kb',
      // Raw body is retained for PayPal webhook signature verification.
      verify: (req, _res, buffer) => {
        (req as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );
  const csrf = randomBytes(24).toString('hex');
  if (hosted) {
    app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));
    app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 10 }));
  }
  app.use((req, res, next) => {
    if (!hosted && !LOOPBACK_HOSTS.includes(req.hostname)) {
      res.status(403).json({ error: 'Local prototype accepts loopback hosts only' });
      return;
    }
    const origin = req.get('Origin');
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || originHost !== req.get('Host')) {
        res.status(403).json({ error: 'Cross-origin request rejected' });
        return;
      }
    }

    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (
      req.path.startsWith('/api/') &&
      req.method === 'POST' &&
      req.get('X-Surety-CSRF') !== csrf
    ) {
      res.status(403).json({ error: 'Refresh the application session' });
      return;
    }
    const authRequired =
      req.path.startsWith('/api/') &&
      req.path !== '/api/config' &&
      !req.path.startsWith('/api/auth/');
    if (authRequired) {
      if (hosted) {
        const payload = sessions.verify(parseCookies(req.get('Cookie'))[SESSION_COOKIE]);
        if (!payload) {
          res.status(401).json({ error: 'Sign in to use the Surety API' });
          return;
        }
        if (req.path.endsWith('/approve') && payload.role !== 'reviewer') {
          res.status(403).json({ error: 'Reviewer role required for approvals' });
          return;
        }
        (req as express.Request & { session?: typeof payload }).session = payload;
      } else if (mode === 'PAYPAL_SANDBOX') {
        const expected = req.path.endsWith('/approve')
          ? process.env.REVIEWER_TOKEN!
          : process.env.OPERATOR_TOKEN!;
        const supplied = req.get('Authorization')?.replace(/^Bearer /, '') || '';
        const a = Buffer.from(expected),
          b = Buffer.from(supplied);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          res.status(401).json({ error: 'Authorized operator or reviewer credential required' });
          return;
        }
      }
    }
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', mode }));
  // ── PayPal webhooks ────────────────────────────────────────
  // External endpoint: no CSRF/session (PayPal posts server-to-server).
  // Security comes from signature verification when PAYPAL_WEBHOOK_ID
  // is set; without it events are accepted but labeled UNVERIFIED and
  // can only trigger re-reads, never state changes.
  const events = new EventStore(filename);
  const webhookConfigured = Boolean(process.env.PAYPAL_WEBHOOK_ID);
  app.post('/webhooks/paypal', async (req, res) => {
    const rawBody = (req as express.Request & { rawBody?: string }).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: 'Body required' });
      return;
    }
    let event: ReturnType<typeof parseWebhookEvent>;
    try {
      event = parseWebhookEvent(rawBody);
    } catch {
      res.status(400).json({ error: 'Malformed webhook event' });
      return;
    }
    if (webhookConfigured) {
      const verified = await verifyWebhookSignature({
        webhookId: process.env.PAYPAL_WEBHOOK_ID!,
        headers: req.headers as WebhookHeaders,
        rawBody,
        clientId: process.env.PAYPAL_CLIENT_ID || '',
        clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
      });
      if (!verified) {
        events.record({ ...event, verification: 'REJECTED' });
        res.status(401).json({ error: 'Webhook signature verification failed' });
        return;
      }
      event.verification = 'SIGNATURE_VERIFIED';
    }
    const fresh = events.record(event);
    // Refund events trigger reconciliation, which re-reads authoritative
    // state via the API before changing anything.
    let reconciledCase: string | null = null;
    if (isRefundEvent(event.eventType) && event.resourceId) {
      const reservation = store.db
        .prepare('SELECT logicalId FROM reservations WHERE refundId=?')
        .get(event.resourceId) as { logicalId: string } | undefined;
      if (reservation) {
        try {
          await service.reconcile(reservation.logicalId);
          reconciledCase = reservation.logicalId;
        } catch {
          // Reconciliation failure is recorded on the case; the webhook acks.
        }
      }
    }
    res.status(200).json({
      received: true,
      duplicate: !fresh,
      verification: event.verification,
      reconciledCase,
    });
  });
  app.get('/api/events', (_req, res) => res.json(events.list()));
  app.get('/api/config', (_req, res) =>
    res.json({
      mode,
      hosted,
      csrf,
      aiConfigured: Boolean(llm),
      aiProvider: llm ? { name: llm.name, model: llm.model } : null,
      scenarios: mode === 'SIMULATION' ? demoScenarios : [],
      transactions: mode === 'SIMULATION' ? records : [],
    }),
  );
  app.post('/api/auth/login', (req, res) => {
    const input = z
      .object({ role: z.enum(['operator', 'reviewer']), password: z.string().min(1).max(200) })
      .strict()
      .parse(req.body);
    const expected = expectedCredentials()[input.role as Role];
    const a = Buffer.from(expected);
    const b = Buffer.from(input.password);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    res.setHeader('Set-Cookie', sessionCookie(sessions.issue(input.role), hosted));
    res.json({ role: input.role });
  });
  app.get('/api/auth/session', (req, res) => {
    const payload = sessions.verify(parseCookies(req.get('Cookie'))[SESSION_COOKIE]);
    if (!payload) {
      res.status(401).json({ error: 'No active session' });
      return;
    }
    res.json({ role: payload.role, expiresAt: payload.exp });
  });
  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearedSessionCookie(hosted));
    res.json({ ok: true });
  });
  app.get('/api/transactions', (_req, res) => res.json(records));
  app.get('/api/cases', (_req, res) => res.json(store.listCases()));
  app.get('/api/cases/:id', (req, res) => res.json(service.get(req.params.id)));
  app.get('/api/cases/:id/export', (req, res) => {
    res.attachment(`factpack-${req.params.id}.json`);
    res.json(service.get(req.params.id));
  });
  app.post('/api/cases', async (req, res) => {
    const input = z
      .object({
        orderId: z.string(),
        statement: z.string().min(1).max(4000),
        amount: z.number().positive(),
        scenario: z.string().optional(),
        useAI: z.boolean(),
      })
      .strict()
      .parse(req.body);
    dollarsToMinor(input.amount);
    const record = records.find((r) => r.orderId === input.orderId);
    if (!record) throw new Error('Order is not in the authorized merchant record set');
    const action = {
      actionType: ActionType.REFUND,
      captureId: record.captureId,
      orderId: record.orderId,
      merchantId: record.merchantId,
      customerId: record.customerId,
      amount: input.amount,
      currency: 'USD',
      reason: 'Merchant support refund',
    };
    let claim;
    if (input.useAI) claim = await extractor.extract(input.statement, record);
    else {
      const scenario = demoScenarios.find((s) => s.id === input.scenario);
      if (
        mode !== 'SIMULATION' ||
        !scenario ||
        record.orderId !== `SIM-ORD-${scenario.id}` ||
        input.statement !== scenario.statement
      )
        throw new Error(
          'Fixture extraction is available only for the unchanged simulation scenario; enable AI for edited messages',
        );
      claim = {
        claimType: scenario.claimType,
        orderReference: record.orderId,
        captureReference: record.captureId,
        customerId: record.customerId,
        merchantId: record.merchantId,
        rawStatement: input.statement,
        extractedAmount: scenario.amount,
        extractedCurrency: 'USD',
        confidence: 0,
      };
    }
    const result = await service.create(action, claim, input.useAI ? 'MODEL' : 'FIXTURE');
    res.status(201).json(result);
  });
  app.post('/api/cases/:id/approve', (req, res) =>
    res.json(
      service.approve(
        req.params.id,
        mode === 'SIMULATION'
          ? hosted
            ? 'HOSTED_REVIEWER'
            : 'SIMULATED_LOCAL_REVIEWER'
          : 'AUTHENTICATED_REVIEWER',
      ),
    ),
  );
  app.post('/api/cases/:id/execute', async (req, res) =>
    res.json(await service.execute(req.params.id, req.body.action)),
  );
  app.post('/api/cases/:id/reconcile', async (req, res) =>
    res.json(await service.reconcile(req.params.id)),
  );
  // Serve the React console when it has been built; otherwise the legacy page.
  const consoleDirectory = join(process.cwd(), 'web', 'dist');
  if (existsSync(consoleDirectory)) {
    app.use(express.static(consoleDirectory));
    app.get('/*splat', (req, res, next) => {
      if (req.path.startsWith('/api/')) next();
      else res.sendFile(join(consoleDirectory, 'index.html'));
    });
  } else {
    app.use(express.static(join(process.cwd(), 'public')));
  }
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error.message });
    },
  );
  return {
    app,
    service,
    close() {
      store.close();
      database.close();
      events.close();
    },
  };
}
if (require.main === module) {
  const runtime = createApplication();
  const port = Number(process.env.PORT || 3100);
  const server = runtime.app.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(
      `Surety listening at http://${process.env.HOST || '127.0.0.1'}:${port}; ${runtime.service.provider.mode}`,
    ),
  );
  process.on('SIGINT', () =>
    server.close(() => {
      runtime.close();
      process.exit(0);
    }),
  );
}
