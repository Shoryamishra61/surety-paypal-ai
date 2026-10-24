import 'dotenv/config';
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { SimulationProvider, demoScenarios } from './providers/simulation';
import { ClaimExtractor } from './providers/claim-extractor';

export function createApplication(filename = process.env.DATABASE_PATH || 'surety.db') {
  const mode = process.env.SURETY_MODE || 'SIMULATION';
  if (!['SIMULATION', 'PAYPAL_SANDBOX'].includes(mode))
    throw new Error('Unsupported mode; production execution is disabled');
  const records: MerchantRecord[] =
    mode === 'SIMULATION'
      ? demoScenarios.map((s) => ({
          orderId: `SIM-ORD-${s.id}`,
          captureId: `SIM-CAP-${s.id}`,
          merchantId: 'SIM-MERCHANT',
          customerId: 'SIM-CUSTOMER',
          shipmentId: `SIM-SHP-${s.id}`,
          fulfillmentState: s.state,
          observedAt: new Date().toISOString(),
        }))
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
        );
  const database = new SuretyDatabase(filename);
  const store = new ExecutionStore(filename);
  const service = new Surety(store, database, provider);
  const extractor = new ClaimExtractor(
    process.env.OPENAI_API_KEY || '',
    process.env.OPENAI_MODEL || '',
  );
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  const csrf = randomBytes(24).toString('hex');
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) {
      res.status(403).json({ error: 'Local prototype accepts loopback hosts only' });
      return;
    }
    const origin = req.get('Origin');
    if (origin && origin !== `http://${req.get('Host')}`) {
      res.status(403).json({ error: 'Cross-origin request rejected' });
      return;
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
    if (req.path.startsWith('/api/') && req.path !== '/api/config' && mode === 'PAYPAL_SANDBOX') {
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
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', mode }));
  app.get('/api/config', (_req, res) =>
    res.json({
      mode,
      csrf,
      aiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
      scenarios: mode === 'SIMULATION' ? demoScenarios : [],
      transactions: mode === 'SIMULATION' ? records : [],
    }),
  );
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
        claimType: scenario.id === 'damaged' ? ClaimType.DAMAGED_ITEM : ClaimType.NOT_DELIVERED,
        orderReference: record.orderId,
        captureReference: record.captureId,
        customerId: record.customerId,
        merchantId: record.merchantId,
        rawStatement: input.statement,
        extractedAmount: 49,
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
        mode === 'SIMULATION' ? 'SIMULATED_LOCAL_REVIEWER' : 'AUTHENTICATED_REVIEWER',
      ),
    ),
  );
  app.post('/api/cases/:id/execute', async (req, res) =>
    res.json(await service.execute(req.params.id, req.body.action)),
  );
  app.post('/api/cases/:id/reconcile', async (req, res) =>
    res.json(await service.reconcile(req.params.id)),
  );
  app.use(express.static(join(process.cwd(), 'public')));
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
    },
  };
}
if (require.main === module) {
  const runtime = createApplication();
  const port = Number(process.env.PORT || 3100);
  const server = runtime.app.listen(port, '127.0.0.1', () =>
    console.log(`Surety listening at http://127.0.0.1:${port}; ${runtime.service.provider.mode}`),
  );
  process.on('SIGINT', () =>
    server.close(() => {
      runtime.close();
      process.exit(0);
    }),
  );
}
