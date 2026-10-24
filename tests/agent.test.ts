import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server';
import { EventBus, SuretyEvent } from '../src/agent/event-bus';
import { runAgent, heuristicStep, summarize } from '../src/agent/agent';
import { GovernedGateway } from '../src/agent/gateway';
import { ClaimExtractor } from '../src/providers/claim-extractor';
import { ClaimType } from '../src/core/types';
import { seededInbox } from '../src/agent/inbox';
import { demoScenarios, scenarioRecord } from '../src/providers/simulation';

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'surety-agent-'));
  const runtime = createApplication(join(directory, 'test.db'));
  return { runtime, directory };
}
const message = (id: string) => seededInbox.find((m) => m.id === id)!;

it('moment 1: honest lost claim auto-executes through the governed gateway', async () => {
  const { runtime, directory } = setup();
  try {
    const bus = new EventBus();
    const gateway = new GovernedGateway(
      runtime.service,
      new ClaimExtractor(null),
      demoScenarios.map(scenarioRecord),
      bus,
    );
    const run = await runAgent(
      { gateway, bus, llm: null, orders: [{ orderId: 'SIM-ORD-lost', summary: 'lamp' }] },
      [message('msg-001')],
    );
    const outcome = run.outcomes[0];
    expect(outcome.action).toBe('propose_refund');
    expect(outcome.proposal?.decision).toBe('EXECUTE');
    expect(outcome.proposal?.executionState).toBe('SUCCEEDED');
    expect(outcome.proposal?.refundId).toMatch(/^SIM-/);
    expect(outcome.proposal?.case.agentId).toBe('aria-support-01');
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('moment 2: false non-delivery claim is blocked with evidence', async () => {
  const { runtime, directory } = setup();
  try {
    const bus = new EventBus();
    const gateway = new GovernedGateway(
      runtime.service,
      new ClaimExtractor(null),
      demoScenarios.map(scenarioRecord),
      bus,
    );
    const run = await runAgent(
      { gateway, bus, llm: null, orders: [{ orderId: 'SIM-ORD-delivered', summary: 'lamp' }] },
      [message('msg-002')],
    );
    const outcome = run.outcomes[0];
    expect(outcome.proposal?.decision).toBe('DENY');
    expect(outcome.proposal?.reasonCodes).toContain('DELIVERY_CONFIRMED');
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('moment 3: prompt injection is refused by the agent brain and flagged by the gateway', async () => {
  const { runtime, directory } = setup();
  try {
    // The heuristic brain refuses instruction-shaped messages outright.
    const step = heuristicStep(message('msg-008'), []);
    expect(step.action).toBe('escalate_human');
    // Even if a proposal slips through with the injection text, the gateway
    // flags it and evidence rules still adjudicate it.
    const bus = new EventBus();
    const gateway = new GovernedGateway(
      runtime.service,
      new ClaimExtractor(null),
      demoScenarios.map(scenarioRecord),
      bus,
    );
    const outcome = await gateway.propose({
      agentId: 'test-agent',
      orderId: 'SIM-ORD-delivered',
      statement: message('msg-008').body,
      amount: 49,
      claimType: ClaimType.NOT_DELIVERED,
    });
    expect(outcome.injectionSuspected).toBe(true);
    expect(outcome.decision).toBe('DENY');
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('moment 4: a $600 claim on a $649 order routes to review, then executes after approval', async () => {
  const { runtime, directory } = setup();
  try {
    const bus = new EventBus();
    const gateway = new GovernedGateway(
      runtime.service,
      new ClaimExtractor(null),
      demoScenarios.map(scenarioRecord),
      bus,
    );
    const run = await runAgent(
      { gateway, bus, llm: null, orders: [{ orderId: 'SIM-ORD-bulk', summary: 'lens' }] },
      [message('msg-011')],
    );
    const outcome = run.outcomes[0];
    expect(outcome.proposal?.decision).toBe('REVIEW');
    expect(outcome.proposal?.reasonCodes).toContain('EXCEEDS_AUTONOMOUS_LIMIT');
    expect(outcome.proposal?.executionState).toBe('NOT_EXECUTED');
    // Reviewer approves the exact action; execution then succeeds.
    runtime.service.approve(outcome.proposal!.caseId, 'reviewer');
    const executed = await runtime.service.execute(outcome.proposal!.caseId);
    expect(executed.executionState).toBe('SUCCEEDED');
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('a $600 claim on a $49 order is denied outright by the balance rule', async () => {
  const { runtime, directory } = setup();
  try {
    const bus = new EventBus();
    const gateway = new GovernedGateway(
      runtime.service,
      new ClaimExtractor(null),
      demoScenarios.map(scenarioRecord),
      bus,
    );
    const run = await runAgent(
      { gateway, bus, llm: null, orders: [{ orderId: 'SIM-ORD-lost', summary: 'lamp' }] },
      [message('msg-007')],
    );
    expect(run.outcomes[0].proposal?.decision).toBe('DENY');
    expect(run.outcomes[0].proposal?.violations.join(' ')).toContain(
      'exceeds remaining refundable',
    );
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('SSE bus carries the full agent trace and summarize() computes the demo numbers', async () => {
  const { runtime, directory } = setup();
  try {
    const bus = new EventBus();
    const gateway = new GovernedGateway(
      runtime.service,
      new ClaimExtractor(null),
      demoScenarios.map(scenarioRecord),
      bus,
    );
    const seen: SuretyEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    const run = await runAgent(
      { gateway, bus, llm: null, orders: [] },
      seededInbox.filter((m) => ['msg-001', 'msg-002', 'msg-008', 'msg-011'].includes(m.id)),
    );
    const types = seen.map((e) => e.type);
    expect(types).toContain('agent.run.started');
    expect(types).toContain('agent.message.read');
    expect(types).toContain('agent.thought');
    expect(types).toContain('gateway.case.created');
    expect(types).toContain('gateway.case.executed');
    expect(types).toContain('gateway.case.denied');
    expect(types).toContain('gateway.case.review');
    // The injection message is refused by the agent brain before the gateway,
    // so no system.notice fires in this run (that path is covered by moment 3).
    expect(run.outcomes.find((o) => o.messageId === 'msg-008')?.action).toBe('escalate_human');
    expect(types).toContain('agent.run.finished');
    const summary = summarize(run.outcomes);
    expect(summary).toMatchObject({
      messages: 4,
      autoExecuted: 1,
      denied: 1,
      review: 1,
      escalated: 1,
    });
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('HTTP surface: inbox listing, agent run, persisted event log', async () => {
  const { runtime, directory } = setup();
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const config = (await (await fetch(base + '/api/config')).json()) as { csrf: string };
    const inbox = (await (await fetch(base + '/api/agent/inbox')).json()) as { id: string }[];
    expect(inbox.length).toBeGreaterThanOrEqual(10);
    expect(inbox[0]).not.toHaveProperty('intent');
    const run = (await (
      await fetch(base + '/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Surety-CSRF': config.csrf },
        body: JSON.stringify({ ids: ['msg-001'] }),
      })
    ).json()) as {
      mode: string;
      outcomes: { proposal: { decision: string; executionState: string } }[];
    };
    expect(run.mode).toBe('HEURISTIC');
    expect(run.outcomes[0].proposal.decision).toBe('EXECUTE');
    expect(run.outcomes[0].proposal.executionState).toBe('SUCCEEDED');
    const events = (await (await fetch(base + '/api/agent/runs')).json()) as {
      event_type: string;
    }[];
    expect(events.some((e) => e.event_type === 'gateway.case.executed')).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
