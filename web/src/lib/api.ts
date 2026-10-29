// Surety console — API client.
// Same-origin fetch with the per-boot CSRF token from /api/config.

export interface SuretyConfig {
  mode: 'SIMULATION' | 'PAYPAL_SANDBOX';
  hosted: boolean;
  csrf: string;
  aiConfigured: boolean;
  aiProvider: { name: string; model: string } | null;
  scenarios: { id: string; title: string; statement: string; state: string }[];
  transactions: {
    orderId: string;
    captureId: string;
    merchantId: string;
    customerId: string;
    shipmentId: string;
    fulfillmentState: string;
    observedAt: string;
  }[];
}

let csrf: string | null = null;

export async function loadConfig(): Promise<SuretyConfig> {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error(`Config unavailable (${response.status})`);
  const config = (await response.json()) as SuretyConfig;
  csrf = config.csrf;
  return config;
}

/** Sign in as one of the hosted-demo roles; sets the session cookie. */
export async function login(role: 'operator' | 'reviewer', password: string): Promise<void> {
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ role, password }) });
}

export async function fetchSession(): Promise<{ role: string; expiresAt: number } | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
  if (!response.ok) return null;
  return (await response.json()) as { role: string; expiresAt: number };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (method === 'POST' && csrf) headers.set('X-Surety-CSRF', csrf);
  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}
