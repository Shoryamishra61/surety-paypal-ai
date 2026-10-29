import { useEffect, useState } from 'react';
import { fetchSession, loadConfig } from './lib/api';
import type { SuretyConfig } from './lib/api';
import { ConfigContext } from './lib/config';
import { useRoute } from './lib/route';
import AgentConsole from './views/AgentConsole';
import Login from './views/Login';
import CaseInbox from './views/CaseInbox';
import CaseDetail from './views/CaseDetail';
import ReviewQueue from './views/ReviewQueue';
import PolicyStudio from './views/PolicyStudio';
import Analytics from './views/Analytics';
import EventLog from './views/EventLog';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/console.css';

const NAV = [
  { route: '/', label: 'Agent console' },
  { route: '/cases', label: 'Case inbox' },
  { route: '/review', label: 'Review queue' },
  { route: '/policy', label: 'Policy' },
  { route: '/analytics', label: 'Analytics' },
  { route: '/events', label: 'Event log' },
];

export default function App() {
  const route = useRoute();
  const [config, setConfig] = useState<SuretyConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    loadConfig()
      .then(setConfig)
      .catch((e: Error) => setConfigError(e.message));
  }, []);

  useEffect(() => {
    if (!config?.hosted) {
      setSessionChecked(true);
      return;
    }
    fetchSession()
      .then((s) => {
        setSession(s?.role ?? null);
        setSessionChecked(true);
      })
      .catch(() => {
        setSession(null);
        setSessionChecked(true);
      });
  }, [config]);

  const gated = config !== null && config.hosted && sessionChecked && session === null;

  return (
    <ConfigContext.Provider value={config}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <a className="wordmark" href="#/">
            Surety
          </a>
          <p className="tagline">Premise-bound execution for payment agents</p>
          <div className="masthead-status" aria-live="polite">
            {configError && <span className="pill pill-stop">{configError}</span>}
            {config && (
              <>
                <span className="pill pill-neutral">
                  {config.mode === 'SIMULATION'
                    ? 'Simulation · no real money'
                    : 'PayPal sandbox · test money'}
                </span>
                {config.aiConfigured && config.aiProvider && (
                  <span className="pill pill-neutral">AI · {config.aiProvider.name}</span>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      {gated ? (
        <main id="main" className="view" style={{ maxWidth: '30rem', margin: '0 auto' }}>
          <Login
            onSignedIn={(role) => {
              setSession(role);
              window.location.reload();
            }}
          />
        </main>
      ) : (
        <div className="shell">
          <nav className="rail" aria-label="Sections">
            <ul>
              {NAV.map((item) => (
                <li key={item.route}>
                  <a
                    href={`#${item.route}`}
                    className={route === item.route ? 'rail-link is-active' : 'rail-link'}
                    aria-current={route === item.route ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <main id="main" tabIndex={-1} className="view">
            {route === '/' && (
              <section className="view-arrive">
                <AgentConsole />
              </section>
            )}
            {route === '/cases' && (
              <section className="view-arrive">
                <CaseInbox />
              </section>
            )}
            {route.startsWith('/cases/') && (
              <section className="view-arrive">
                <CaseDetail caseId={route.slice('/cases/'.length)} />
              </section>
            )}
            {route === '/review' && (
              <section className="view-arrive">
                <ReviewQueue />
              </section>
            )}
            {route === '/policy' && (
              <section className="view-arrive">
                <PolicyStudio />
              </section>
            )}
            {route === '/analytics' && (
              <section className="view-arrive">
                <Analytics />
              </section>
            )}
            {route === '/events' && (
              <section className="view-arrive">
                <EventLog />
              </section>
            )}
          </main>
        </div>
      )}
      <footer className="colophon">
        <p>
          Merchant-reported delivery is evidence, not independent proof. Built for the PayPal AI
          Hackathon.
        </p>
      </footer>
    </ConfigContext.Provider>
  );
}
