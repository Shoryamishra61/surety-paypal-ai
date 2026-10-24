// ============================================================
// SURETY — Minimal fixed-window rate limiter.
//
// In-memory per key. Deployments are single-instance; the
// limiter exists to blunt credential stuffing and accidental
// request floods on the hosted demo, not as a full WAF.
// ============================================================

import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  key?(req: Request): string;
}

interface Window {
  count: number;
  expiresAt: number;
}

export function rateLimit(options: RateLimitOptions) {
  const windows = new Map<string, Window>();
  const keyOf = options.key ?? ((req: Request) => req.ip ?? 'unknown');
  // Periodic sweep so idle keys do not accumulate for the process lifetime.
  const sweeper = setInterval(
    () => {
      const now = Date.now();
      for (const [key, window] of windows) if (window.expiresAt <= now) windows.delete(key);
    },
    Math.max(options.windowMs, 60_000),
  );
  sweeper.unref?.();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyOf(req);
    const now = Date.now();
    const window = windows.get(key);
    if (!window || window.expiresAt <= now) {
      windows.set(key, { count: 1, expiresAt: now + options.windowMs });
      next();
      return;
    }
    window.count += 1;
    if (window.count > options.max) {
      res.status(429).json({ error: 'Too many requests; slow down' });
      return;
    }
    next();
  };
}
