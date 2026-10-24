// Shared primitives for the forensic-ledger console.

import type { ReactNode } from 'react';

export function Pill({ tone, children }: { tone: 'go' | 'stop' | 'hold' | 'neutral'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function SectionHeading({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <header className="view-head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </header>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{hint}</p>
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <p className="loading" role="status">{label}…</p>;
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <p className="error-line" role="alert">
      {message}
    </p>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
