// Hosted-demo sign-in. Two roles: operator (browse, propose) and
// reviewer (approve). The demo passwords are shown on the card —
// this is a public judging demo, not production auth.

import { useState } from 'react';
import { login } from '../lib/api';

export default function Login({ onSignedIn }: { onSignedIn: (role: string) => void }) {
  const [role, setRole] = useState<'operator' | 'reviewer'>('operator');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(role, password);
      onSignedIn(role);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <p className="eyebrow">Surety demo</p>
        <h1>Sign in</h1>
        <p className="lede">
          This hosted demo is gated by role. Pick a role and use its password below.
        </p>
        <form onSubmit={submit}>
          <fieldset
            className="login-roles"
            style={{ border: 0, padding: 0, margin: '0 0 var(--s4)' }}
          >
            <div className="login-role-row">
              <label className="form-check-inline">
                <input
                  type="radio"
                  name="role"
                  checked={role === 'operator'}
                  onChange={() => setRole('operator')}
                />{' '}
                Operator
              </label>
              <label className="form-check-inline">
                <input
                  type="radio"
                  name="role"
                  checked={role === 'reviewer'}
                  onChange={() => setRole('reviewer')}
                />{' '}
                Reviewer
              </label>
            </div>
          </fieldset>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="error-line" role="alert">
              {error}
            </p>
          )}
          <div className="run-controls">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || password.length === 0}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <dl className="ledger login-demo-creds">
          <div>
            <dt>Operator password</dt>
            <dd>
              <code>operator-demo</code>
            </dd>
          </div>
          <div>
            <dt>Reviewer password</dt>
            <dd>
              <code>reviewer-demo</code>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
