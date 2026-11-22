import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { RabbitMq } from '../messaging/rabbitmq';
import { registry } from '../observability/metrics';
import type { Database } from '../persistence/database';
import type { S3VideoStorage } from '../storage/s3-video-storage';

export const DATABASE = Symbol('Database');
export const RABBITMQ = Symbol('RabbitMq');
export const STORAGE = Symbol('S3VideoStorage');

/** Rotas de infraestrutura (não expostas pelo gateway). */
@Controller()
export class SystemController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RABBITMQ) private readonly rabbit: RabbitMq,
    @Inject(STORAGE) private readonly storage: S3VideoStorage,
  ) {}

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const [database, storage] = await Promise.all([this.db.isHealthy(), this.storage.isHealthy()]);
    const rabbitmq = this.rabbit.isConnected;
    // RabbitMQ fora não derruba o serviço: o upload continua aceito via outbox.
    const ok = database && storage;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? (rabbitmq ? 'ok' : 'degraded') : 'down',
      checks: { database, storage, rabbitmq },
    };
  }

  @Get('metrics')
  async metrics(@Res() res: Response) {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
