// Policy Studio — the merchant's agent guardrails: per-currency
// autonomous caps and daily limits. Edits apply to future
// adjudications; every case records the policy version it used.

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PolicyConfigWire } from '../lib/types';
import { ErrorLine, Loading, SectionHeading } from '../components/ui';

export default function PolicyStudio() {
  const [config, setConfig] = useState<PolicyConfigWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PolicyConfigWire>('/api/policy')
      .then(setConfig)
      .catch((e: Error) => setError(e.message));
  }, []);

  function updateCurrency(
    index: number,
    field: keyof PolicyConfigWire['currencies'][number],
    value: string,
  ) {
    setConfig((previous) => {
      if (!previous) return previous;
      const currencies = previous.currencies.map((entry, i) =>
        i === index ? { ...entry, [field]: Number(value) } : entry,
      );
      return { ...previous, currencies };
    });
    setSaved(false);
  }

  async function save() {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<PolicyConfigWire>('/api/policy', {
        method: 'PUT',
        body: JSON.stringify({ currencies: config.currencies }),
      });
      setConfig(updated);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeading
        eyebrow="Policy studio"
        title="The guardrails the agent runs inside."
        lede="Autonomous refunds stop at the per-transaction cap. Larger proposals still reach humans through the review queue. Daily limits are hard rails for agents; a human approval can exceed them, never the refundable balance."
      />
      {error && <ErrorLine message={error} />}
      {!config && !error && <Loading label="Loading policy" />}
      {config && (
        <form
          className="policy-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {config.currencies.map((entry, index) => (
            <fieldset key={entry.currency} className="currency-block">
              <h3>{entry.currency}</h3>
              <div className="currency-fields">
                <label className="field">
                  <span>Autonomous cap per refund</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={entry.maxAutonomousRefundAmount}
                    onChange={(e) =>
                      updateCurrency(index, 'maxAutonomousRefundAmount', e.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>Customer daily limit</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={entry.customerDailyLimit}
                    onChange={(e) => updateCurrency(index, 'customerDailyLimit', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Merchant daily limit</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={entry.merchantDailyLimit}
                    onChange={(e) => updateCurrency(index, 'merchantDailyLimit', e.target.value)}
                  />
                </label>
              </div>
            </fieldset>
          ))}
          <div className="policy-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Apply policy'}
            </button>
            {saved && (
              <span className="save-note" role="status">
                Applied. New cases use these limits; past cases keep their recorded policy version.
              </span>
            )}
          </div>
          <p className="stat-label" style={{ marginTop: 'var(--s4)' }}>
            Policy version <code>{config.version}</code> ·{' '}
            {config.alwaysRequireApproval
              ? 'Human approval always required'
              : 'Verified claims automate within caps'}
          </p>
        </form>
      )}
    </>
  );
}
