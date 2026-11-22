import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { SmtpMailer } from '../mail/smtp-mailer';
import type { VideoFailedConsumer } from '../messaging/video-failed.consumer';
import { registry } from '../observability/metrics';

export const REDIS = Symbol('Redis');
export const SMTP_MAILER = Symbol('SmtpMailer');
export const CONSUMER = Symbol('VideoFailedConsumer');

/** O serviço não tem API pública: só health e métricas (não expostos pelo gateway). */
@Controller()
export class SystemController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMTP_MAILER) private readonly mailer: SmtpMailer,
    @Inject(CONSUMER) private readonly consumer: VideoFailedConsumer,
  ) {}

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const [redis, smtp] = await Promise.all([
      this.redis
        .ping()
        .then((r) => r === 'PONG')
        .catch(() => false),
      this.mailer.isHealthy(),
    ]);
    const rabbitmq = this.consumer.isConnected;
    const ok = redis && smtp && rabbitmq;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'down', checks: { rabbitmq, redis, smtp } };
  }

  @Get('metrics')
  async metrics(@Res() res: Response) {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
