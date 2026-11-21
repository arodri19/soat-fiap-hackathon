import { Controller, Get, Header, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { ACCESS_TOKEN_SERVICE } from '../../application/ports';
import { registry } from '../observability/metrics';
import type { Database } from '../persistence/database';
import type { JoseAccessTokenService } from '../security/jose-access-token-service';

export const DATABASE = Symbol('Database');
export const REDIS = Symbol('Redis');

/** Rotas de infraestrutura. O gateway não expõe nenhuma delas para fora. */
@Controller()
export class SystemController {
  constructor(
    @Inject(ACCESS_TOKEN_SERVICE) private readonly tokens: JoseAccessTokenService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.tokens.jwks();
  }

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      this.db.isHealthy(),
      this.redis
        .ping()
        .then((r) => r === 'PONG')
        .catch(() => false),
    ]);
    const ok = database && redis;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database, redis } };
  }

  @Get('metrics')
  async metrics(@Res() res: Response) {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
