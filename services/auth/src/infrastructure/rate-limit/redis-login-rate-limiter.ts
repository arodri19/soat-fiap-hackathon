import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { LoginRateLimiter, RateLimitStatus } from '../../application/ports';

export interface RateLimitSettings {
  maxAttempts: number;
  windowSeconds: number;
}

/**
 * Janela fixa no Redis: conta falhas de login por chave (e-mail + IP).
 * Compartilhado entre réplicas do serviço. A chave é guardada como hash para
 * não deixar e-mails em texto no Redis.
 */
export class RedisLoginRateLimiter implements LoginRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly settings: RateLimitSettings,
  ) {}

  private key(raw: string): string {
    return `auth:login-failures:${createHash('sha256').update(raw).digest('hex')}`;
  }

  async status(raw: string): Promise<RateLimitStatus> {
    const key = this.key(raw);
    const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    const blocked = Number(count ?? 0) >= this.settings.maxAttempts;
    return { blocked, retryAfterSeconds: blocked ? Math.max(ttl, 1) : 0 };
  }

  async registerFailure(raw: string): Promise<void> {
    const key = this.key(raw);
    await this.redis
      .multi()
      .incr(key)
      .expire(key, this.settings.windowSeconds, 'NX') // a janela começa na 1ª falha
      .exec();
  }

  async reset(raw: string): Promise<void> {
    await this.redis.del(this.key(raw));
  }
}
