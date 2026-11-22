import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'notification' });
collectDefaultMetrics({ register: registry });

export const notifications = new Counter({
  name: 'notifications_total',
  help: 'Notificações de falha por resultado',
  labelNames: ['result'] as const, // sent | duplicate | invalid | retry
  registers: [registry],
});
