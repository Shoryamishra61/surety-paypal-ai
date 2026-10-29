// Case Detail — the FactPack: claim, evidence with provenance,
// verdict, policy outcome, and execution record for one case.

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { navigate } from '../lib/route';
import { CLAIM_LABELS, decisionMeta, formatDateTime, formatMoney } from '../lib/format';
import type { CaseRecord } from '../lib/types';
import { ErrorLine, Loading, Pill, SectionHeading } from '../components/ui';

interface TimelineEntry {
  label: string;
  at: string;
}

function timelineOf(record: CaseRecord): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ label: 'Proposal received', at: record.createdAt }];
  const approval = record.approvalLifecycle;
  if (approval) {
    entries.push({
      label: `Reviewer approved (${approval.approvedBy ?? 'reviewer'})`,
      at: approval.createdAt,
    });
  }
  if (record.executionState === 'SUCCEEDED' && record.refundId)
    entries.push({
      label: `Refund executed · ${record.refundId}`,
      at: record.updatedAt ?? record.createdAt,
    });
  else if (record.executionState === 'PENDING')
    entries.push({
      label: 'PayPal outcome pending — reconcile before retry',
      at: record.updatedAt ?? record.createdAt,
    });
  else if (record.decision === 'DENY')
    entries.push({
      label: 'Blocked by evidence — no payment call made',
      at: record.updatedAt ?? record.createdAt,
    });
  else if (record.decision === 'REVIEW' && !approval)
    entries.push({ label: 'Waiting for a reviewer', at: record.updatedAt ?? record.createdAt });
  return entries;
}

export default function CaseDetail({ caseId }: { caseId: string }) {
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CaseRecord>(`/api/cases/${caseId}`)
      .then(setRecord)
      .catch((e: Error) => setError(e.message));
  }, [caseId]);

  if (error) return <ErrorLine message={error} />;
  if (!record) return <Loading label="Loading case" />;

  const decision = decisionMeta(
    record.executionState === 'NOT_EXECUTED' ? record.decision : record.executionState,
  );

  return (
    <>
      <a className="back-link" href="#/cases">
        ← All cases
      </a>
      <SectionHeading
        eyebrow={`Case · ${new Date(record.createdAt).toLocaleDateString()}`}
        title={CLAIM_LABELS[record.claim.claimType] ?? record.claim.claimType}
      />
      <div className="case-grid">
        <div>
          <dl className="ledger">
            <div>
              <dt>Customer said</dt>
              <dd>
                <blockquote className="statement-quote">{record.claim.rawStatement}</blockquote>
              </dd>
            </div>
            <div>
              <dt>Proposed refund</dt>
              <dd>
                <span className="num">
                  {formatMoney(record.action.amount, record.action.currency)}
                </span>{' '}
                by {record.agentId ?? 'a human operator'}
                {record.agentId && <span className="stat-label"> (agent)</span>}
              </dd>
            </div>
            <div>
              <dt>Outcome</dt>
              <dd>
                <Pill tone={decision.tone}>{decision.label}</Pill>{' '}
                {record.refundId && <code>{record.refundId}</code>}
                {record.injectionSuspected && (
                  <p className="injection-flag">
                    Instruction-shaped content was detected in this message.
                  </p>
                )}
                {record.error && <ErrorLine message={record.error} />}
              </dd>
            </div>
            <div>
              <dt>Reasons</dt>
              <dd>
                <code>
                  {[...record.verification.reasonCodes, ...record.policy.reasonCodes].join(', ') ||
                    '—'}
                </code>
                {record.policy.violations.length > 0 && (
                  <ul
                    style={{
                      margin: '0.5rem 0 0',
                      paddingLeft: '1.1rem',
                      color: 'var(--stop-ink)',
                    }}
                  >
                    {record.policy.violations.map((violation) => (
                      <li key={violation}>{violation}</li>
                    ))}
                  </ul>
                )}
                {record.verification.unresolvedFacts.map((fact) => (
                  <p key={fact} style={{ margin: '0.4rem 0 0', color: 'var(--hold-ink)' }}>
                    {fact}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
          <h3 style={{ marginTop: 'var(--s5)' }}>Evidence considered</h3>
          <ul className="evidence-list">
            {record.verification.evidenceUsed.map((evidence) => (
              <li key={evidence.evidenceId} className="evidence-row">
                <div>
                  <div className="evidence-id">
                    {evidence.recordType} · {evidence.providerId}
                  </div>
                  <p className="evidence-provenance">{evidence.provenance}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Pill
                    tone={
                      evidence.state === 'DELIVERED'
                        ? 'stop'
                        : evidence.state === 'LOST'
                          ? 'go'
                          : 'neutral'
                    }
                  >
                    {evidence.state}
                  </Pill>
                  <div className="stat-label" style={{ marginTop: '0.3rem' }}>
                    {formatDateTime(evidence.timestamp)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <dl className="ledger">
            <div>
              <dt>Case</dt>
              <dd>
                <code>{record.caseId}</code>
              </dd>
            </div>
            <div>
              <dt>Order / capture</dt>
              <dd>
                <code>
                  {record.action.orderId} · {record.action.captureId}
                </code>
              </dd>
            </div>
            <div>
              <dt>Relationship graph</dt>
              <dd>
                {record.verification.relationshipBinding.graph.map((node) => (
                  <div key={`${node.type}-${node.providerId}`} className="stat-label">
                    {node.type} ← {node.parentId ?? 'root'} · <code>{node.providerId}</code> (
                    {node.state})
                  </div>
                ))}
              </dd>
            </div>
            <div>
              <dt>Extraction</dt>
              <dd>
                {record.extractionMode === 'MODEL'
                  ? 'Model-typed claim, server-validated'
                  : record.extractionMode === 'MANUAL'
                    ? 'Caller-typed claim, evidence-verified'
                    : 'Fixture claim'}
              </dd>
            </div>
            <div>
              <dt>Policy version</dt>
              <dd>
                <code>{record.policy.policyVersion}</code> · autonomous cap{' '}
                <span className="num">
                  {formatMoney(record.policy.maxAutonomousAmount, record.action.currency)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Digests</dt>
              <dd>
                <code style={{ fontSize: '0.75rem' }}>evidence {record.caseId.slice(0, 8)}…</code>
              </dd>
            </div>
          </dl>
          <h3 style={{ marginTop: 'var(--s5)' }}>Timeline</h3>
          <ol className="timeline">
            {timelineOf(record).map((entry) => (
              <li key={entry.label}>
                <span className="timeline-dot" aria-hidden="true" />
                <span className="timeline-label">{entry.label}</span>
                <span className="timeline-time num">{formatDateTime(entry.at)}</span>
              </li>
            ))}
          </ol>
          <div className="policy-actions">
            <a className="btn" href={`/api/cases/${record.caseId}/export`}>
              Download FactPack
            </a>
            <button className="btn" onClick={() => navigate('/review')}>
              Review queue
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
