// ============================================================
// SURETY — Agent event bus.
//
// In-process pub/sub with a replay ring buffer. Every agent
// step, gateway decision, and execution outcome is published
// here and streamed to consoles over SSE. Events are also
// persisted by the caller (agent step store); the bus itself
// is transport only.
// ============================================================

export type SuretyEventType =
  | 'agent.run.started'
  | 'agent.run.finished'
  | 'agent.run.finished.message'
  | 'agent.thought'
  | 'agent.tool.called'
  | 'agent.tool.result'
  | 'agent.message.read'
  | 'gateway.case.created'
  | 'gateway.case.executed'
  | 'gateway.case.denied'
  | 'gateway.case.review'
  | 'system.notice';

export interface SuretyEvent {
  id: number;
  at: string;
  type: SuretyEventType;
  runId: string | null;
  payload: Record<string, unknown>;
}

type Listener = (event: SuretyEvent) => void;

export class EventBus {
  private buffer: SuretyEvent[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;
  constructor(private readonly history = 200) {}

  publish(
    type: SuretyEventType,
    payload: Record<string, unknown>,
    runId: string | null = null,
  ): SuretyEvent {
    const event: SuretyEvent = {
      id: this.nextId++,
      at: new Date().toISOString(),
      type,
      runId,
      payload,
    };
    this.buffer.push(event);
    if (this.buffer.length > this.history) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken console subscriber must never break adjudication.
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Recent events for replay on reconnect, optionally after an id. */
  replay(afterId = 0): SuretyEvent[] {
    return this.buffer.filter((e) => e.id > afterId);
  }
}
