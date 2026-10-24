// Agent Console — watch ARIA read the inbox, reason, and propose
// refunds through the governed gateway. Every step streams live.
// Outcomes are written as plain sentences; raw reason codes stay
// secondary, one quiet line per outcome.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useConfig } from '../lib/config';
import { subscribeToEvents } from '../lib/sse';
import { decisionMeta, eventLabel, formatMoney, formatTime } from '../lib/format';
import type { AgentRunSummary, InboxMessageView, SuretyEventWire } from '../lib/types';
import { EmptyState, ErrorLine, Loading, Pill, SectionHeading } from '../components/ui';

const RUNNABLE_IDS = [
  'msg-001',
  'msg-002',
  'msg-003',
  'msg-004',
  'msg-005',
  'msg-006',
  'msg-007',
  'msg-008',
  'msg-009',
  'msg-010',
  'msg-011',
];

/** Reason codes in plain English, most decisive first for each verdict. */
const REASON_PHRASES: [RegExp, string][] = [
  [/^FULLY_REFUNDED$/, 'this purchase was already refunded in full'],
  [/^PRIOR_REFUND_CONFIRMED$/, 'this amount was already refunded'],
  [/^DELIVERY_CONFIRMED$/, 'delivery records show the package arrived'],
  [/^SINGLE_CAPTURE_ONLY$/, 'there is only one charge — nothing was duplicated'],
  [/^SHIPMENT_LOST$/, 'a fresh lost-shipment record supports the claim'],
  [/^DUPLICATE_CAPTURE_CONFIRMED$/, 'settlement history shows two identical charges'],
  [/^AMOUNT_DISCREPANCY_CONFIRMED$/, 'the charge differs from the order total'],
  [/^SUBJECTIVE_CLAIM$/, 'whether the item is damaged is a judgment call'],
  [/^EXCEEDS_AUTONOMOUS_LIMIT$/, 'the amount is above the agent’s autonomous cap'],
  [/^EXCEEDS_CUSTOMER_DAILY_LIMIT$/, 'the customer’s daily refund limit was reached'],
  [/^EXCEEDS_MERCHANT_DAILY_LIMIT$/, 'the merchant’s daily refund limit was reached'],
  [/^NO_DELIVERY_EVIDENCE$/, 'no delivery record could be found'],
  [/^UNTRUSTED_STALE_OR_CONFLICTING_EVIDENCE$/, 'the delivery records are stale or conflict'],
  [/^INCOMPLETE_RELATIONSHIPS$/, 'the transaction relationships are incomplete'],
  [/^PREMISE_BLOCKED$/, 'the evidence contradicts the claim'],
];

function reasonPhrases(codes: string[]): string[] {
  const phrases: string[] = [];
  for (const [pattern, phrase] of REASON_PHRASES) {
    if (codes.some((code) => pattern.test(code)) && !phrases.includes(phrase)) phrases.push(phrase);
  }
  return phrases.slice(0, 2);
}

function decisionSentence(outcome: AgentRunSummary['outcomes'][number]): string {
  const proposal = outcome.proposal;
  if (outcome.error) return `Could not complete this one: ${outcome.error}`;
  if (!proposal) {
    if (outcome.action === 'escalate_human')
      return 'Escalated to a person — the request needs human judgment.';
    return 'Replied without proposing a refund.';
  }
  const amount = formatMoney(proposal.amount, proposal.currency);
  const phrases = reasonPhrases(proposal.reasonCodes);
  const reason = phrases.length ? ` — ${phrases.join(', and ')}` : '';
  if (proposal.decision === 'EXECUTE' && proposal.executionState === 'SUCCEEDED')
    return `Refunded ${amount} to the customer${reason ? ` — ${phrases.join(', and ')}` : ''}.`;
  if (proposal.decision === 'EXECUTE')
    return `The ${amount} refund was submitted; PayPal reports it as ${proposal.executionState.toLowerCase()}.`;
  if (proposal.decision === 'DENY') return `Blocked the ${amount} refund${reason}.`;
  return `Paused the ${amount} refund for a person${reason}.`;
}

function rawCodes(codes: string[]): string {
  return codes.filter((code) => !code.startsWith('SOURCE:')).join(' · ');
}

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

  useEffect(
    () => subscribeToEvents((event) => setEvents((previous) => [...previous.slice(-199), event])),
    [],
  );

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [events]);

  const aiLive = config?.aiConfigured === true;

  const totals = useMemo(() => {
    if (!summary) return null;
    const outcomes = summary.outcomes;
    const refunded = outcomes.filter((o) => o.proposal?.executionState === 'SUCCEEDED');
    const blocked = outcomes.filter((o) => o.proposal?.decision === 'DENY').length;
    const review = outcomes.filter((o) => o.proposal?.decision === 'REVIEW').length;
    const escalated = outcomes.filter((o) => o.action === 'escalate_human').length;
    const replied = outcomes.filter((o) => o.action === 'reply_only').length;
    return {
      messages: outcomes.length,
      refunded: refunded.length,
      refundedTotal: refunded.reduce((sum, o) => sum + (o.proposal?.amount ?? 0), 0),
      blocked,
      review,
      escalated,
      replied,
    };
  }, [summary]);

  const inboxFor = useMemo(() => {
    const map = new Map<string, InboxMessageView>();
    for (const message of inbox ?? []) map.set(message.id, message);
    return map;
  }, [inbox]);

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
              {aiLive
                ? 'LLM brain · live'
                : 'Deterministic brain (add an AI key for the LLM brain)'}
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
                      {message.orderHint && (
                        <span className="inbox-order mono">{message.orderHint}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="run-controls">
            <button
              className="btn btn-primary"
              onClick={run}
              disabled={running || selected.size === 0}
            >
              {running
                ? 'Agent working…'
                : `Run agent on ${selected.size} message${selected.size === 1 ? '' : 's'}`}
            </button>
            <button
              className="btn"
              onClick={() => setSelected(new Set(RUNNABLE_IDS))}
              disabled={running}
            >
              Select all
            </button>
          </div>
          {totals && (
            <p className="run-summary" role="status">
              <strong className="num">{totals.messages}</strong> messages —{' '}
              {totals.refunded > 0 && (
                <>
                  <strong className="num num-go">{totals.refunded}</strong> refunded
                  {totals.refundedTotal > 0 && (
                    <span className="run-total"> ({formatMoney(totals.refundedTotal, 'USD')})</span>
                  )}{' '}
                  ·{' '}
                </>
              )}
              <strong className="num num-stop">{totals.blocked}</strong> blocked ·{' '}
              <strong className="num num-hold">{totals.review}</strong> for review ·{' '}
              <strong className="num">{totals.escalated}</strong> escalated
              {totals.replied > 0 && (
                <>
                  {' '}
                  · <strong className="num">{totals.replied}</strong> replied
                </>
              )}
            </p>
          )}
          {summary && (
            <ul className="outcome-list">
              {summary.outcomes.map((outcome) => {
                const message = inboxFor.get(outcome.messageId);
                const meta = outcome.proposal
                  ? decisionMeta(outcome.proposal.decision)
                  : {
                      label: outcome.action === 'escalate_human' ? 'Escalated' : 'Replied',
                      tone: 'neutral' as const,
                    };
                const codes = outcome.proposal ? rawCodes(outcome.proposal.reasonCodes) : '';
                return (
                  <li key={outcome.messageId} className="outcome-row">
                    <div className="outcome-head">
                      <span className="outcome-who">
                        {message ? message.from : outcome.messageId}
                        <span className="outcome-subject">
                          {message ? ` — ${message.subject}` : ''}
                        </span>
                      </span>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>
                    <p className="outcome-decision">{decisionSentence(outcome)}</p>
                    {codes && (
                      <p className="outcome-codes mono" title={codes}>
                        {codes}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-label="Live trace" className="trace-panel">
          <div className="panel-head">
            <h2>Live trace</h2>
            <span className="panel-meta">
              {events.length > 0 ? `${events.length} events` : 'streaming'}
            </span>
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
        return {
          tone: 'go' as const,
          detail: `${String(event.payload.executionState ?? '')}${event.payload.refundId ? ` · ${String(event.payload.refundId)}` : ''}`,
        };
      case 'gateway.case.denied':
        return {
          tone: 'stop' as const,
          detail: Array.isArray(event.payload.reasonCodes)
            ? (event.payload.reasonCodes as string[])
                .filter((c) => !c.startsWith('SOURCE:'))
                .slice(0, 2)
                .join(', ')
            : '',
        };
      case 'gateway.case.review':
        return { tone: 'hold' as const, detail: 'Routed to the review queue' };
      case 'agent.thought':
        return {
          tone: 'neutral' as const,
          detail: String(event.payload.thought ?? '').slice(0, 140),
        };
      case 'agent.message.read':
        return {
          tone: 'neutral' as const,
          detail: `${String(event.payload.from ?? '')} — ${String(event.payload.subject ?? '')}`,
        };
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
