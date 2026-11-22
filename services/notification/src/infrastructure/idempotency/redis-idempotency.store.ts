import type Redis from 'ioredis';
import type { ClaimResult, IdempotencyStore } from '../../application/ports';

/**
 * Deduplicação no Redis, compartilhada entre réplicas.
 *  - claim: SET NX com TTL curto ("pending"), para duas réplicas não enviarem juntas;
 *  - markSent: guarda "sent" por alguns dias;
 *  - release: apaga a reserva se o envio falhou.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly pendingTtlSeconds = 120;

  constructor(
    private readonly redis: Redis,
    private readonly sentTtlDays: number,
  ) {}

  private key(eventId: string): string {
    return `notification:video-failed:${eventId}`;
  }

  async claim(eventId: string): Promise<ClaimResult> {
    const ok = await this.redis.set(
      this.key(eventId),
      'pending',
      'EX',
      this.pendingTtlSeconds,
      'NX',
    );
    return ok === 'OK' ? 'claimed' : 'already-handled';
  }

  async markSent(eventId: string): Promise<void> {
    await this.redis.set(this.key(eventId), 'sent', 'EX', this.sentTtlDays * 24 * 60 * 60);
  }

  async release(eventId: string): Promise<void> {
    await this.redis.del(this.key(eventId));
  }
}
