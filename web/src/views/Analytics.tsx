// Analytics — what the governor did, as a ledger of record:
// dollars moved, dollars kept, verdict mix, and agent activity.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { CaseRecord } from '../lib/types';
import { ErrorLine, Loading, SectionHeading } from '../components/ui';

export default function Analytics() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CaseRecord[]>('/api/cases')
      .then(setCases)
      .catch((e: Error) => setError(e.message));
  }, []);

  const stats = useMemo(() => {
    if (!cases) return null;
    const succeeded = cases.filter((c) => c.executionState === 'SUCCEEDED');
    const denied = cases.filter((c) => c.decision === 'DENY');
    const review = cases.filter((c) => c.decision === 'REVIEW' && c.executionState !== 'SUCCEEDED');
    const refunded = succeeded.reduce((sum, c) => sum + c.action.amount, 0);
    const blocked = denied.reduce((sum, c) => sum + c.action.amount, 0);
    const byClaim = new Map<string, number>();
    for (const record of cases)
      byClaim.set(record.claim.claimType, (byClaim.get(record.claim.claimType) ?? 0) + 1);
    const agentCases = cases.filter((c) => c.agentId);
    return {
      total: cases.length,
      refunded,
      blocked,
      succeeded: succeeded.length,
      denied: denied.length,
      review: review.length,
      injections: cases.filter((c) => c.injectionSuspected).length,
      agentShare: cases.length ? Math.round((agentCases.length / cases.length) * 100) : 0,
      byClaim: [...byClaim.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [cases]);

  return (
    <>
      <SectionHeading
        eyebrow="Analytics"
        title="What the governor did."
        lede="A running account of agent proposals: what executed, what was blocked, and what waited for a person."
      />
      {error && <ErrorLine message={error} />}
      {!cases && !error && <Loading label="Computing" />}
      {stats && (
        <>
          <ul className="stat-ledger">
            <li>
              <span className="stat-label">Refunded through the gateway</span>
              <span className="stat-value">{formatMoney(stats.refunded, 'USD')}</span>
            </li>
            <li>
              <span className="stat-label">Blocked before money moved</span>
              <span className="stat-value">{formatMoney(stats.blocked, 'USD')}</span>
            </li>
            <li>
              <span className="stat-label">Cases adjudicated</span>
              <span className="stat-value">{stats.total}</span>
            </li>
            <li>
              <span className="stat-label">Share proposed by agents</span>
              <span className="stat-value">{stats.agentShare}%</span>
            </li>
            <li>
              <span className="stat-label">Injection attempts flagged</span>
              <span className="stat-value">{stats.injections}</span>
            </li>
          </ul>
          <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--s2)' }}>Verdict mix</h2>
          <div className="bar-row">
            <span className="stat-label">Executed</span>
            <div className="bar-track">
              <div className="bar-fill tone-go" style={{ width: `${pct(stats.succeeded, stats.total)}%` }} />
            </div>
            <span className="bar-value">{stats.succeeded}</span>
          </div>
          <div className="bar-row">
            <span className="stat-label">Blocked</span>
            <div className="bar-track">
              <div className="bar-fill tone-stop" style={{ width: `${pct(stats.denied, stats.total)}%` }} />
            </div>
            <span className="bar-value">{stats.denied}</span>
          </div>
          <div className="bar-row">
            <span className="stat-label">Review</span>
            <div className="bar-track">
              <div className="bar-fill tone-hold" style={{ width: `${pct(stats.review, stats.total)}%` }} />
            </div>
            <span className="bar-value">{stats.review}</span>
          </div>
          <h2 style={{ fontSize: '1.2rem', margin: 'var(--s5) 0 var(--s2)' }}>Claims by type</h2>
          {stats.byClaim.map(([claim, count]) => (
            <div key={claim} className="bar-row">
              <span className="stat-label">{claim.replaceAll('_', ' ').toLowerCase()}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct(count, stats.total)}%` }} />
              </div>
              <span className="bar-value">{count}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.max(2, Math.round((part / total) * 100));
}
