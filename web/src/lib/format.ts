// Ledger formatting: money, time, and verdict labels.

const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
  KRW: 0,
};

export function formatMoney(amount: number, currency: string): string {
  const exponent = CURRENCY_EXPONENTS[currency] ?? 2;
  const minor = Math.round(amount * 10 ** exponent);
  const absolute = minor.toString().padStart(exponent + 1, '0');
  const whole = absolute.slice(0, absolute.length - exponent) || '0';
  const fraction = exponent ? '.' + absolute.slice(absolute.length - exponent) : '';
  return `${currency} ${whole}${fraction}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const CLAIM_LABELS: Record<string, string> = {
  NOT_DELIVERED: 'Not delivered',
  DUPLICATE_CHARGE: 'Duplicate charge',
  ALREADY_REFUNDED: 'Already refunded',
  WRONG_AMOUNT: 'Wrong amount',
  DAMAGED_ITEM: 'Damaged item',
  NOT_AS_DESCRIBED: 'Not as described',
  CANCELLATION_REFUND: 'Cancellation refund',
  OTHER: 'Other',
};

export const DECISION_META: Record<
  string,
  { label: string; tone: 'go' | 'stop' | 'hold' | 'neutral' }
> = {
  EXECUTE: { label: 'Safe to refund', tone: 'go' },
  EXECUTED: { label: 'Refunded', tone: 'go' },
  SUCCEEDED: { label: 'Refunded', tone: 'go' },
  DENY: { label: 'Blocked', tone: 'stop' },
  DENIED: { label: 'Blocked', tone: 'stop' },
  REVIEW: { label: 'Needs a person', tone: 'hold' },
  PENDING: { label: 'Waiting on PayPal', tone: 'hold' },
  NOT_EXECUTED: { label: 'Not executed', tone: 'neutral' },
  EXECUTING: { label: 'Executing', tone: 'hold' },
  FAILED: { label: 'Failed', tone: 'stop' },
};

export function decisionMeta(state: string) {
  return DECISION_META[state] ?? { label: state, tone: 'neutral' as const };
}

export function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    'agent.run.started': 'Agent run started',
    'agent.run.finished': 'Agent run finished',
    'agent.run.finished.message': 'Message processed',
    'agent.thought': 'Agent reasoning',
    'agent.tool.called': 'Tool called',
    'agent.tool.result': 'Tool result',
    'agent.message.read': 'Message read',
    'gateway.case.created': 'Case created',
    'gateway.case.executed': 'Refund executed',
    'gateway.case.denied': 'Proposal blocked',
    'gateway.case.review': 'Routed to review',
    'system.notice': 'Notice',
  };
  return labels[type] ?? type;
}
