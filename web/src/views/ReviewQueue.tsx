// Review Queue — cases waiting for a human, with exact-action
// approval. Reviewers can authorize the amount the policy paused,
// never override contradicted premises.

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CLAIM_LABELS, formatDateTime, formatMoney } from '../lib/format';
import type { CaseRecord } from '../lib/types';
import { EmptyState, ErrorLine, Loading, Pill, SectionHeading } from '../components/ui';

export default function ReviewQueue() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api<CaseRecord[]>('/api/cases')
      .then(setCases)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function approve(caseId: string) {
    setBusy(caseId);
    setNotice(null);
    try {
      await api(`/api/cases/${caseId}/approve`, { method: 'POST', body: '{}' });
      await api(`/api/cases/${caseId}/execute`, { method: 'POST', body: '{}' });
      setNotice('Approved and executed.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pending = (cases ?? []).filter(
    (record) => record.decision === 'REVIEW' && record.executionState === 'NOT_EXECUTED',
  );

  return (
    <>
      <SectionHeading
        eyebrow="Review queue"
        title="Judgments that belong to a person."
        lede="These proposals passed premise verification but exceed autonomous limits or carry subjective claims. Approving executes the exact action shown — nothing more."
      />
      {error && <ErrorLine message={error} />}
      {notice && (
        <p className="save-note" role="status">
          {notice}
        </p>
      )}
      {!cases && !error && <Loading label="Loading queue" />}
      {cases && pending.length === 0 && (
        <EmptyState
          title="The queue is clear."
          hint="When the agent proposes something above the autonomous cap or with an unresolved premise, it lands here for a human decision."
        />
      )}
      {pending.map((record) => (
        <article key={record.caseId} className="review-row">
          <div className="review-row-head">
            <div>
              <strong>{CLAIM_LABELS[record.claim.claimType] ?? record.claim.claimType}</strong>{' '}
              <span className="stat-label">
                · {record.action.orderId} · {formatDateTime(record.createdAt)}
              </span>
            </div>
            <Pill tone="hold">Needs a person</Pill>
          </div>
          <blockquote className="statement-quote">{record.claim.rawStatement}</blockquote>
          <dl className="ledger compact">
            <div>
              <dt>Exact action</dt>
              <dd>
                Refund{' '}
                <span className="num">
                  {formatMoney(record.action.amount, record.action.currency)}
                </span>{' '}
                to <code>{record.action.customerId}</code>
              </dd>
            </div>
            <div>
              <dt>Why here</dt>
              <dd>
                <code>{record.policy.reasonCodes.join(', ')}</code>
              </dd>
            </div>
            {record.verification.unresolvedFacts.length > 0 && (
              <div>
                <dt>Open facts</dt>
                <dd>{record.verification.unresolvedFacts.join(' ')}</dd>
              </div>
            )}
          </dl>
          <div className="review-actions">
            <button
              className="btn btn-primary"
              disabled={busy === record.caseId}
              onClick={() => approve(record.caseId)}
            >
              {busy === record.caseId
                ? 'Executing…'
                : `Approve ${formatMoney(record.action.amount, record.action.currency)}`}
            </button>
            <a className="btn" href={`#/cases/${record.caseId}`}>
              Inspect evidence
            </a>
          </div>
        </article>
      ))}
    </>
  );
}
