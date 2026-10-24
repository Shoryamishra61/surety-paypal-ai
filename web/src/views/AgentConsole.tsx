// Agent Console — watch ARIA read the inbox, reason, and propose
// refunds through the governed gateway. Every step streams live.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useConfig } from '../lib/config';
import { subscribeToEvents } from '../lib/sse';
import { decisionMeta, eventLabel, formatMoney, formatTime } from '../lib/format';
import type { AgentRunSummary, InboxMessageView, SuretyEventWire } from '../lib/types';
import { EmptyState, ErrorLine, Loading, Pill, SectionHeading } from '../components/ui';

const RUNNABLE_IDS = [
  'msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005',
  'msg-006', 'msg-007', 'msg-008', 'msg-009', 'msg-010', 'msg-011',
];

export default function AgentConsole() {
  const config = useConfig();
  const [inbox, setInbox] = useState<InboxMessageView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(RUNNABLE_IDS));
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<SuretyEventWire[]>([]);
  const [summary, setSummary] = useState<AgentRunSummary | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<InboxMessageView[]>('/api/agent/inbox')
      .then(setInbox)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => subscribeToEvents((event) => setEvents((previous) => [...previous.slice(-199), event])), []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [events]);

  const aiLive = config?.aiConfigured === true;

  const runSummaryLine = useMemo(() => {
    if (!summary) return null;
    const refunded = summary.outcomes.filter((o) => o.proposal?.executionState === 'SUCCEEDED').length;
    const blocked = summary.outcomes.filter((o) => o.proposal?.decision === 'DENY').length;
    const review = summary.outcomes.filter((o) => o.proposal?.decision === 'REVIEW').length;
    const escalated = summary.outcomes.filter((o) => o.action === 'escalate_human').length;
    const total = summary.outcomes
      .filter((o) => o.proposal?.executionState === 'SUCCEEDED')
      .reduce((sum, o) => sum + (o.proposal?.amount ?? 0), 0);
    return `${summary.outcomes.length} messages · ${refunded} refunded (${formatMoney(total, 'USD')}) · ${blocked} blocked · ${review} for review · ${escalated} escalated`;
  }, [summary]);

  async function run() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const result = await api<AgentRunSummary>('/api/agent/run', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected] }),
      });
      setSummary(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <SectionHeading
        eyebrow="Agent console"
        title="ARIA is reading the inbox."
        lede="The agent proposes refunds through the governed gateway. Surety checks every claim against payment and delivery records before money moves — live, below."
      />
      <div className="console-grid">
        <section aria-label="Support inbox" className="inbox-panel">
          <div className="panel-head">
            <h2>Support inbox</h2>
            <span className="panel-meta">
              {aiLive ? 'LLM brain · live' : 'Deterministic brain (add an AI key for the LLM brain)'}
            </span>
          </div>
          {error && <ErrorLine message={error} />}
          {!inbox && <Loading label="Loading inbox" />}
          {inbox && (
            <ul className="inbox-list">
              {inbox.map((message) => (
                <li key={message.id}>
                  <label className="inbox-row">
                    <input
                      type="checkbox"
                      checked={selected.has(message.id)}
                      onChange={() => toggle(message.id)}
                    />
                    <span className="inbox-body">
                      <span className="inbox-from">{message.from}</span>
                      <span className="inbox-subject">{message.subject}</span>
                      <span className="inbox-preview">{message.body}</span>
                      {message.orderHint && <span className="inbox-order mono">{message.orderHint}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="run-controls">
            <button className="btn btn-primary" onClick={run} disabled={running || selected.size === 0}>
              {running ? 'Agent working…' : `Run agent on ${selected.size} message${selected.size === 1 ? '' : 's'}`}
            </button>
            <button
              className="btn"
              onClick={() => setSelected(new Set(RUNNABLE_IDS))}
              disabled={running}
            >
              Select all
            </button>
          </div>
          {runSummaryLine && (
            <p className="run-summary num" role="status">
              {runSummaryLine}
            </p>
          )}
          {summary && (
            <ul className="outcome-list">
              {summary.outcomes.map((outcome) => (
                <li key={outcome.messageId} className="outcome-row">
                  <div className="outcome-head">
                    <span className="mono">{outcome.messageId}</span>
                    {outcome.proposal ? (
                      <Pill tone={decisionMeta(outcome.proposal.decision).tone}>
                        {decisionMeta(outcome.proposal.decision).label}
                      </Pill>
                    ) : (
                      <Pill tone="neutral">
                        {outcome.action === 'escalate_human' ? 'Escalated' : 'Replied'}
                      </Pill>
                    )}
                  </div>
                  <p className="outcome-thought">{outcome.thought}</p>
                  {outcome.proposal && (
                    <dl className="ledger compact">
                      <div>
                        <dt>Amount</dt>
                        <dd className="num">{formatMoney(outcome.proposal.amount, outcome.proposal.currency)}</dd>
                      </div>
                      <div>
                        <dt>Reasons</dt>
                        <dd className="mono">{outcome.proposal.reasonCodes.slice(0, 3).join(', ')}</dd>
                      </div>
                    </dl>
                  )}
                  {outcome.proposal?.injectionSuspected && (
                    <p className="injection-flag">Instruction-shaped content flagged; adjudicated under standard evidence rules.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Live trace" className="trace-panel">
          <div className="panel-head">
            <h2>Live trace</h2>
            <span className="panel-meta">{events.length > 0 ? `${events.length} events` : 'streaming'}</span>
          </div>
          <div className="trace-feed" ref={feedRef} aria-live="polite">
            {events.length === 0 && (
              <EmptyState
                title="Nothing yet."
                hint="Select inbox messages and run the agent — every read, thought, and decision lands here."
              />
            )}
            {events.map((event) => (
              <TraceLine key={event.id} event={event} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function TraceLine({ event }: { event: SuretyEventWire }) {
  const meta = (() => {
    switch (event.type) {
      case 'gateway.case.executed':
        return { tone: 'go' as const, detail: `${String(event.payload.executionState ?? '')} ${event.payload.refundId ? `· ${String(event.payload.refundId)}` : ''}` };
      case 'gateway.case.denied':
        return { tone: 'stop' as const, detail: Array.isArray(event.payload.reasonCodes) ? (event.payload.reasonCodes as string[]).slice(0, 2).join(', ') : '' };
      case 'gateway.case.review':
        return { tone: 'hold' as const, detail: 'Routed to the review queue' };
      case 'agent.thought':
        return { tone: 'neutral' as const, detail: String(event.payload.thought ?? '').slice(0, 140) };
      case 'agent.message.read':
        return { tone: 'neutral' as const, detail: `${String(event.payload.from ?? '')} — ${String(event.payload.subject ?? '')}` };
      case 'system.notice':
        return { tone: 'hold' as const, detail: String(event.payload.message ?? '') };
      default:
        return { tone: 'neutral' as const, detail: '' };
    }
  })();
  return (
    <div className={`trace-line tone-${meta.tone}`}>
      <span className="trace-time num">{formatTime(event.at)}</span>
      <span className="trace-label">{eventLabel(event.type)}</span>
      {meta.detail && <span className="trace-detail">{meta.detail}</span>}
    </div>
  );
}
