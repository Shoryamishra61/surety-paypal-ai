// Event Log — PayPal webhooks and agent activity, the durable
// record behind the live stream.

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { WebhookEventRow } from '../lib/types';
import { EmptyState, ErrorLine, Loading, Pill, SectionHeading } from '../components/ui';

interface AgentEventRow {
  seq: number;
  event_type: string;
  run_id: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export default function EventLog() {
  const [webhooks, setWebhooks] = useState<WebhookEventRow[] | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<WebhookEventRow[]>('/api/events'), api<AgentEventRow[]>('/api/agent/runs')])
      .then(([hookEvents, agent]) => {
        setWebhooks(hookEvents);
        setAgentEvents(agent);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <SectionHeading
        eyebrow="Event log"
        title="What the system heard."
        lede="PayPal webhooks arrive with signature verification; agent steps are persisted as they stream. Events are hints for reconciliation — money state always comes from the payment API."
      />
      {error && <ErrorLine message={error} />}
      <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--s2)' }}>PayPal webhooks</h2>
      {!webhooks && !error && <Loading label="Loading webhooks" />}
      {webhooks && webhooks.length === 0 && (
        <EmptyState
          title="No webhooks received yet."
          hint="Add a webhook in the PayPal developer dashboard pointing at /webhooks/paypal on a public URL to see live payment events land here."
        />
      )}
      {webhooks && webhooks.length > 0 && (
        <table className="event-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Type</th>
              <th>Resource</th>
              <th>Verification</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((event) => (
              <tr key={event.event_id}>
                <td className="num">{formatDateTime(event.received_at)}</td>
                <td>
                  <code>{event.event_type}</code>
                </td>
                <td className="num">{event.resource_id ?? '—'}</td>
                <td>
                  <Pill tone={event.verification === 'SIGNATURE_VERIFIED' ? 'go' : 'hold'}>
                    {event.verification === 'SIGNATURE_VERIFIED' ? 'Signature verified' : 'Unverified'}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 style={{ fontSize: '1.2rem', margin: 'var(--s5) 0 var(--s2)' }}>Recent agent activity</h2>
      {!agentEvents && !error && <Loading label="Loading agent events" />}
      {agentEvents && agentEvents.length === 0 && (
        <EmptyState title="No agent activity yet." hint="Run the agent from the console; every step is persisted here." />
      )}
      {agentEvents && agentEvents.length > 0 && (
        <table className="event-table">
          <thead>
            <tr>
              <th>At</th>
              <th>Event</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {agentEvents.slice(0, 60).map((event) => (
              <tr key={event.seq}>
                <td className="num">{formatDateTime(event.at)}</td>
                <td>
                  <code>{event.event_type}</code>
                </td>
                <td>{summarizePayload(event.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  const text = (payload.thought ?? payload.message ?? payload.subject ?? payload.decision ?? payload.executionState ?? '') as string;
  return String(text).slice(0, 120) || Object.keys(payload).slice(0, 3).join(', ');
}
