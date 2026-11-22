import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'video-api' });
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 60],
  registers: [registry],
});

export const uploads = new Counter({
  name: 'videos_uploaded_total',
  help: 'Uploads por resultado',
  labelNames: ['result'] as const, // accepted | rejected | failed
  registers: [registry],
});

export const uploadBytes = new Counter({
  name: 'videos_uploaded_bytes_total',
  help: 'Bytes de vídeo recebidos',
  registers: [registry],
});

export const outboxPublished = new Counter({
  name: 'outbox_published_total',
  help: 'Mensagens da outbox publicadas no RabbitMQ',
  labelNames: ['routing_key'] as const,
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: 'outbox_pending',
  help: 'Mensagens na outbox aguardando publicação',
  registers: [registry],
});

export const statusEvents = new Counter({
  name: 'video_status_events_total',
  help: 'Eventos de status recebidos do worker',
  labelNames: ['routing_key', 'result'] as const, // applied | ignored | invalid | retry
  registers: [registry],
});

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}
