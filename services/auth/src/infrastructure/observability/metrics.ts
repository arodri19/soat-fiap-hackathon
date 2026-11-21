import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'auth' });
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const loginAttempts = new Counter({
  name: 'auth_login_attempts_total',
  help: 'Tentativas de login por resultado',
  labelNames: ['result'] as const, // success | invalid_credentials | rate_limited
  registers: [registry],
});

export const registrations = new Counter({
  name: 'auth_registrations_total',
  help: 'Cadastros por resultado',
  labelNames: ['result'] as const, // success | email_taken | invalid
  registers: [registry],
});

export const refreshes = new Counter({
  name: 'auth_token_refresh_total',
  help: 'Renovações de sessão por resultado',
  labelNames: ['result'] as const, // success | invalid
  registers: [registry],
});

/** Mede todas as requisições usando a rota declarada (não a URL crua, para não explodir cardinalidade). */
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}
