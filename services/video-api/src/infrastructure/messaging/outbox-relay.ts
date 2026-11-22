import { Logger } from '@nestjs/common';
import type { Database } from '../persistence/database';
import { outboxPending, outboxPublished } from '../observability/metrics';
import type { RabbitMq } from './rabbitmq';

interface OutboxRow {
  id: string;
  exchange: string;
  routing_key: string;
  message_id: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}

/**
 * Publica as mensagens da outbox no RabbitMQ (padrão Transactional Outbox).
 *
 * - `FOR UPDATE SKIP LOCKED`: várias réplicas podem rodar o relay sem publicar a
 *   mesma mensagem duas vezes ao mesmo tempo.
 * - A linha só é marcada como publicada depois do confirm do broker; se o RabbitMQ
 *   estiver fora, a mensagem fica na tabela e é publicada quando ele voltar.
 * - Entrega at-least-once: o consumidor é idempotente (message_id / video_id).
 */
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly db: Database,
    private readonly rabbit: RabbitMq,
    private readonly settings: { intervalMs: number; batchSize: number },
  ) {}

  start(): void {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      this.running = this.tick().then(
        () => undefined,
        (error: Error) => this.logger.warn(`Falha ao publicar a outbox: ${error.message}`),
      );
      await this.running;
      if (!this.stopped) this.timer = setTimeout(loop, this.settings.intervalMs);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  /** Publica um lote. Retorna quantas mensagens foram publicadas. */
  async tick(): Promise<number> {
    if (!this.rabbit.isConnected) {
      await this.refreshPendingGauge();
      return 0;
    }
    let published = 0;
    await this.db.transaction(async (client) => {
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, exchange, routing_key, message_id, payload, headers
           FROM outbox
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.settings.batchSize],
      );
      for (const row of rows) {
        try {
          await this.rabbit.publish(
            row.exchange,
            row.routing_key,
            Buffer.from(JSON.stringify(row.payload)),
            {
              messageId: row.message_id,
              correlationId: (row.payload.video_id as string | undefined) ?? undefined,
              headers: row.headers,
            },
          );
          await client.query(
            `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`,
            [row.id],
          );
          outboxPublished.inc({ routing_key: row.routing_key });
          published++;
        } catch (error) {
          await client.query(
            `UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
            [row.id, (error as Error).message.slice(0, 500)],
          );
          break; // mantém a ordem: tenta de novo no próximo ciclo
        }
      }
    });
    await this.refreshPendingGauge();
    return published;
  }

  private async refreshPendingGauge(): Promise<void> {
    const { rows } = await this.db.pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM outbox WHERE published_at IS NULL`,
    );
    outboxPending.set(Number(rows[0].total));
  }
}
