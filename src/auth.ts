// ============================================================
// SURETY — Session authentication for hosted deployments.
//
// Zero-dependency HMAC-signed tokens delivered as HttpOnly,
// SameSite=Strict cookies. Two roles: operator and reviewer.
// Loopback development needs no session; sessions gate the
// hosted demo where the bind address is public.
// ============================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type Role = 'operator' | 'reviewer';

export interface SessionPayload {
  role: Role;
  iat: number;
  exp: number;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'surety_session';

export class SessionAuth {
  private secret: Buffer;

  constructor(secret = process.env.SESSION_SECRET) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  issue(role: Role, now = Date.now()): string {
    const payload: SessionPayload = { role, iat: now, exp: now + SESSION_TTL_MS };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string | undefined, now = Date.now()): SessionPayload | null {
    if (!token) return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = this.sign(body);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
      if (payload.exp <= now) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function sessionCookie(token: string, secure: boolean): string {
  const attributes = ['HttpOnly', 'SameSite=Strict', 'Path=/'];
  if (secure) attributes.push('Secure');
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${attributes.join('; ')}`;
}

export function clearedSessionCookie(secure: boolean): string {
  const attributes = ['HttpOnly', 'SameSite=Strict', 'Path=', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return `${SESSION_COOKIE}=; ${attributes.join('; ')}`;
}

/** Demo credentials: configurable per deployment, with documented defaults for the hosted demo. */
export function expectedCredentials(): Record<Role, string> {
  return {
    operator: process.env.DEMO_OPERATOR_PASSWORD || 'operator-demo',
    reviewer: process.env.DEMO_REVIEWER_PASSWORD || 'reviewer-demo',
  };
}
